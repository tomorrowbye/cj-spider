import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Kysely, PGliteDialect, sql } from 'kysely';
import { PGlite } from '@electric-sql/pglite';
import { migrate } from '../db/migrate';
import { up } from '../db/migrations/002-mcp';
import type { Database } from '../src/lib/db';
import { ApiKeyError, authenticateApiKey, createApiKey, listApiKeys, revokeApiKey } from '../src/lib/api-keys';

async function fixture() {
  const db = new Kysely<Database>({ dialect: new PGliteDialect({ pglite: new PGlite() }) });
  await migrate(db);
  const user = await db.insertInto('site_users').values({ username: 'key-owner', password_hash: 'unused', role: 'admin' }).returning(['id', 'username', 'role', 'is_active']).executeTakeFirstOrThrow();
  return { db, user };
}

test('keys use random 32-byte secrets, store only SHA-256, list metadata, and log safely', async t => {
  const { db, user } = await fixture();
  const logs: string[] = [];
  t.mock.method(console, 'info', (line: string) => logs.push(line));
  try {
    const key = await createApiKey({ userId: user.id, name: ' Agent ', expiresInDays: 2 }, db);
    assert.match(key.key, /^cjsk_[a-f0-9]{8}_[A-Za-z0-9_-]{43}$/);
    assert.equal(Buffer.from(key.key.split('_').slice(2).join('_'), 'base64url').length, 32);
    assert.equal(key.name, 'Agent');
    const row = await db.selectFrom('api_keys').selectAll().executeTakeFirstOrThrow();
    assert.equal(row.key_hash, createHash('sha256').update(key.key).digest('hex'));
    assert.ok(!JSON.stringify(row).includes(key.key));
    assert.ok(Math.abs(new Date(key.expires_at!).getTime() - Date.now() - 2 * 86400000) < 5000);
    const listed = await listApiKeys(user, false, db);
    assert.equal(listed.length, 1);
    assert.deepEqual(Object.keys(listed[0]).sort(), ['id', 'name', 'key_prefix', 'created_at', 'last_used_at', 'expires_at', 'revoked_at'].sort());
    await revokeApiKey(key.id, user, db);
    assert.equal(logs.length, 2);
    for (const line of logs) {
      const log = JSON.parse(line);
      assert.equal(log.actor_user_id, user.id); assert.equal(log.key_prefix, key.key_prefix); assert.ok(log.at);
    }
    assert.ok(!logs.join('').includes(key.key));
    assert.ok(!logs.join('').includes(row.key_hash));
  } finally { await db.destroy(); }
});

test('authentication rejects invalid, unknown, revoked, expired, disabled and deleted credentials; role is live', async () => {
  const { db, user } = await fixture();
  try {
    const created = await createApiKey({ userId: user.id, name: 'auth' }, db);
    const header = `Bearer ${created.key}`;
    assert.deepEqual(await authenticateApiKey(header, db), { user, apiKey: { id: created.id, key_prefix: created.key_prefix } });
    for (const invalid of [null, '', created.key, 'Bearer invalid', `Basic ${created.key}`, `Bearer cjsk_${randomBytes(4).toString('hex')}_${randomBytes(32).toString('base64url')}`, `Bearer cjsk_${created.key_prefix}_${randomBytes(32).toString('base64url')}`]) assert.equal(await authenticateApiKey(invalid, db), null);
    await db.updateTable('site_users').set({ role: 'user' }).where('id', '=', user.id).execute();
    assert.equal((await authenticateApiKey(header, db))?.user.role, 'user');
    await db.updateTable('site_users').set({ is_active: false }).where('id', '=', user.id).execute();
    assert.equal(await authenticateApiKey(header, db), null);
    await db.updateTable('site_users').set({ is_active: true }).where('id', '=', user.id).execute();
    await db.updateTable('api_keys').set({ expires_at: new Date(Date.now() - 1000).toISOString() }).where('id', '=', created.id).execute();
    assert.equal(await authenticateApiKey(header, db), null);
    await db.updateTable('api_keys').set({ expires_at: null }).where('id', '=', created.id).execute();
    await revokeApiKey(created.id, user, db);
    assert.equal(await authenticateApiKey(header, db), null);
    const other = await createApiKey({ userId: user.id, name: 'deleted' }, db);
    await db.deleteFrom('site_users').where('id', '=', user.id).execute();
    assert.equal(await authenticateApiKey(`Bearer ${other.key}`, db), null);
    assert.equal((await db.selectFrom('api_keys').selectAll().execute()).length, 0);
    // Unknown prefixes still flow through timingSafeEqual with a fixed-length dummy.
    const source = readFileSync('src/lib/api-keys.ts', 'utf8');
    assert.match(source, /: dummyHash/); assert.match(source, /timingSafeEqual\(hashKey\(match\[1\]\), stored\)/);
  } finally { await db.destroy(); }
});

test('last_used_at changes only after 60 seconds, with database-conditional writes', async () => {
  const { db, user } = await fixture();
  try {
    const key = await createApiKey({ userId: user.id, name: 'throttle' }, db);
    const read = () => db.selectFrom('api_keys').select('last_used_at').where('id', '=', key.id).executeTakeFirstOrThrow();
    assert.equal((await read()).last_used_at, null);
    await authenticateApiKey(`Bearer ${key.key}`, db);
    const first = new Date((await read()).last_used_at!).getTime();
    await authenticateApiKey(`Bearer ${key.key}`, db);
    assert.equal(new Date((await read()).last_used_at!).getTime(), first);
    await db.updateTable('api_keys').set({ last_used_at: sql<string>`now() - interval '61 seconds'` }).where('id', '=', key.id).execute();
    await authenticateApiKey(`Bearer ${key.key}`, db);
    assert.ok(new Date((await read()).last_used_at!).getTime() >= first);
  } finally { await db.destroy(); }
});

test('cap is transactional under concurrent creation, counts expired keys, and frees revoked slots', async t => {
  const { db, user } = await fixture();
  t.mock.method(console, 'info', () => {});
  try {
    const results = await Promise.allSettled(Array.from({ length: 12 }, (_, i) => createApiKey({ userId: user.id, name: `key ${i}` }, db)));
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 10);
    assert.equal(results.filter(r => r.status === 'rejected').length, 2);
    const keys = await listApiKeys(user, false, db);
    await db.updateTable('api_keys').set({ expires_at: new Date(0).toISOString() }).where('id', '=', keys[0].id).execute();
    await assert.rejects(createApiKey({ userId: user.id, name: 'over cap' }, db), ApiKeyError);
    await revokeApiKey(keys[0].id, user, db);
    await createApiKey({ userId: user.id, name: 'replacement' }, db);
    for (const name of ['', ' ', 'x'.repeat(101)]) await assert.rejects(createApiKey({ userId: user.id, name }, db), ApiKeyError);
    for (const days of [0, -1, 1.5, NaN, 36501]) await assert.rejects(createApiKey({ userId: user.id, name: 'invalid', expiresInDays: days }, db), ApiKeyError);
  } finally { await db.destroy(); }
});

test('own/admin permissions and JWT-only management route guards', async t => {
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'fake-api-key-jwt-test-secret';
  t.after(() => { if (previousSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previousSecret; });
  const { db, user: admin } = await fixture();
  try {
    const user = await db.insertInto('site_users').values({ username: 'other-user', password_hash: 'unused' }).returning(['id', 'username', 'role', 'is_active']).executeTakeFirstOrThrow();
    const key = await createApiKey({ userId: admin.id, name: 'admin key' }, db);
    const { resolveSession } = await import('../src/lib/auth-session');
    const { authorizeApi } = await import('../src/lib/auth-gate');
    const session = await resolveSession(key.key, async () => { throw new Error('API key must not resolve as JWT'); });
    assert.equal(session, null);
    assert.equal((await authorizeApi(session))?.status, 401);
    assert.deepEqual(await listApiKeys(user, false, db), []);
    await assert.rejects(listApiKeys(user, true, db), (e: unknown) => e instanceof ApiKeyError && e.status === 403);
    await assert.rejects(revokeApiKey(key.id, user, db), (e: unknown) => e instanceof ApiKeyError && e.status === 404);
    assert.equal((await listApiKeys(admin, true, db))[0].username, admin.username);
    const otherKey = await createApiKey({ userId: user.id, name: 'user key' }, db);
    await revokeApiKey(otherKey.id, admin, db);
    assert.equal(await authenticateApiKey(`Bearer ${otherKey.key}`, db), null);
    for (const path of ['src/app/api/api-keys/route.ts', 'src/app/api/api-keys/[id]/route.ts']) {
      const source = readFileSync(path, 'utf8');
      for (const handler of source.matchAll(/export async function (GET|POST|DELETE)[^{]*\{/g)) {
        // DELETE's signature includes a type literal, so check the full handler slice.
        assert.match(source.slice(handler.index), /const authError = await requireSiteAuth\(\);\s*if \(authError\) return authError;/);
      }
      assert.doesNotMatch(source, /authenticateApiKey/);
    }
  } finally { await db.destroy(); }
});

test('migration is idempotent and audit survives key and user deletion with null foreign keys', async () => {
  const { db, user } = await fixture();
  try {
    await up(db as unknown as Kysely<unknown>); await up(db as unknown as Kysely<unknown>);
    const key = await createApiKey({ userId: user.id, name: 'audited' }, db);
    const audit = await db.insertInto('mcp_audit_log').values({ user_id: user.id, api_key_id: key.id, tool: 'list_recent_news', args_redacted: {}, ok: true, error: null, duration_ms: 1, task_id: null }).returning('id').executeTakeFirstOrThrow();
    await db.deleteFrom('api_keys').where('id', '=', key.id).execute();
    const afterKey = await db.selectFrom('mcp_audit_log').selectAll().where('id', '=', audit.id).executeTakeFirstOrThrow();
    assert.equal(afterKey.api_key_id, null); assert.equal(afterKey.user_id, user.id);
    const secondKey = await createApiKey({ userId: user.id, name: 'cascade' }, db);
    await db.insertInto('mcp_audit_log').values({ user_id: user.id, api_key_id: secondKey.id, tool: 'list_recent_news', args_redacted: {}, ok: true, error: null, duration_ms: 1, task_id: null }).execute();
    await db.deleteFrom('site_users').where('id', '=', user.id).execute();
    const rows = await db.selectFrom('mcp_audit_log').selectAll().execute();
    assert.equal(rows.length, 2);
    assert.ok(rows.every(row => row.user_id === null && row.api_key_id === null));
  } finally { await db.destroy(); }
});
