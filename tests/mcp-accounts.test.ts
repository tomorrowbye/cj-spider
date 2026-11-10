import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Kysely, PGliteDialect, sql } from 'kysely';
import { PGlite } from '@electric-sql/pglite';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { migrate } from '../db/migrate';
import type { Database } from '../src/lib/db';
import { createApiKey } from '../src/lib/api-keys';
import { createUserValidated, verifyPassword } from '../src/lib/auth';
import { createMcpHandler } from '../src/lib/mcp/handler';

function connect(handler: (r: Request) => Promise<Response>, key: string) {
  const client = new Client({ name: 'accounts-test', version: '1' });
  const transport = new StreamableHTTPClientTransport(new URL('http://mcp.test/api/mcp'), {
    requestInit: { headers: { Authorization: `Bearer ${key}` } }, fetch: (input, init) => handler(new Request(input, init)),
  });
  return { client, transport };
}
function output(value: Awaited<ReturnType<Client['callTool']>>) { return value.structuredContent as Record<string, unknown>; }

test('SDK create_user follows live roles, shares validation, hashes passwords and redacts audit/log output', async () => {
  const db = new Kysely<Database>({ dialect: new PGliteDialect({ pglite: new PGlite() }) });
  await migrate(db);
  const admin = await db.insertInto('site_users').values({ username: 'key-admin', password_hash: 'unused', role: 'admin' }).returningAll().executeTakeFirstOrThrow();
  const key = await createApiKey({ userId: admin.id, name: 'admin test' }, db);
  const logs: string[] = [];
  const handler = createMcpHandler({ db, env: {}, log: line => logs.push(line) });
  const { client, transport } = connect(handler, key.key);
  try {
    await client.connect(transport);
    const created = output(await client.callTool({ name: 'create_user', arguments: { username: 'generated-user', role: 'admin' } }));
    const password = created.generated_password as string;
    assert.ok(password.length >= 16);
    assert.equal(created.role, 'admin');
    const row = await db.selectFrom('site_users').selectAll().where('username', '=', 'generated-user').executeTakeFirstOrThrow();
    assert.notEqual(row.password_hash, password);
    assert.equal(await verifyPassword(password, row.password_hash), true);
    const identity = await db.selectFrom('auth_identities').selectAll().where('user_id', '=', row.id).executeTakeFirstOrThrow();
    assert.equal(identity.provider, 'local'); assert.equal(identity.provider_subject, row.username);
    const explicit = output(await client.callTool({ name: 'create_user', arguments: { username: 'explicit-user', password: 'provided-secret' } }));
    assert.equal(explicit.role, 'user'); assert.equal(Object.hasOwn(explicit, 'generated_password'), false);
    const duplicate = output(await client.callTool({ name: 'create_user', arguments: { username: 'generated-user' } }));
    assert.equal(duplicate.error, '用户名已存在'); assert.equal(Object.hasOwn(duplicate, 'generated_password'), false);
    for (const args of [{ username: 'ab', password: '1234' }, { username: 'a'.repeat(51), password: '1234' }, { username: 'valid', password: '123' }, { username: 'valid', password: '1234', role: 'owner' }]) {
      assert.equal((await createUserValidated(args, db)).success, false);
      assert.equal((await client.callTool({ name: 'create_user', arguments: args })).isError, true);
    }
    await sql`ALTER TABLE auth_identities ADD CONSTRAINT reject_test_identity CHECK (provider_subject <> 'rollback-user')`.execute(db);
    const rolledBack = await client.callTool({ name: 'create_user', arguments: { username: 'rollback-user' } });
    assert.equal(rolledBack.isError, true);
    assert.equal(Object.hasOwn(output(rolledBack), 'generated_password'), false);
    assert.equal(await db.selectFrom('site_users').select('id').where('username', '=', 'rollback-user').executeTakeFirst(), undefined);
    await db.updateTable('site_users').set({ role: 'user' }).where('id', '=', admin.id).execute();
    const forbidden = await client.callTool({ name: 'create_user', arguments: { username: 'forbidden-user' } });
    assert.equal(forbidden.isError, true); assert.equal(output(forbidden).error, 'forbidden: admin only');
    assert.notEqual((await client.callTool({ name: 'list_recent_news', arguments: {} })).isError, true);
    const audits = await db.selectFrom('mcp_audit_log').selectAll().execute();
    assert.ok(audits.every(a => a.user_id === admin.id && a.api_key_id === key.id));
    assert.ok(audits.some(a => a.error === 'forbidden: admin only' && !a.ok));
    const serialized = JSON.stringify(audits) + logs.join('');
    for (const secret of [password, 'provided-secret', key.key]) assert.equal(serialized.includes(secret), false);
    assert.ok(logs.every(line => JSON.parse(line).key_prefix === key.key_prefix));
    await db.updateTable('site_users').set({ is_active: false }).where('id', '=', admin.id).execute();
    await assert.rejects(client.listTools());
    await db.updateTable('site_users').set({ is_active: true }).where('id', '=', admin.id).execute();
    await db.updateTable('api_keys').set({ revoked_at: new Date().toISOString() }).where('id', '=', key.id).execute();
    await assert.rejects(client.listTools());
    const expired = await createApiKey({ userId: admin.id, name: 'expired' }, db);
    await db.updateTable('api_keys').set({ expires_at: new Date(0).toISOString() }).where('id', '=', expired.id).execute();
    for (const supplied of [key.key, expired.key, 'cjsk_obviously_fake']) {
      const denied = await handler(new Request('http://mcp.test', { headers: { Authorization: `Bearer ${supplied}` } }));
      assert.equal(denied.status, 401); assert.equal(denied.headers.get('www-authenticate'), 'Bearer');
      assert.deepEqual(await denied.json(), { error: 'Unauthorized' });
    }
  } finally { await client.close(); await db.destroy(); }
});

test('SDK rate buckets are isolated per key and failed authentication is isolated per IP', async () => {
  const db = new Kysely<Database>({ dialect: new PGliteDialect({ pglite: new PGlite() }) });
  await migrate(db);
  const user = await db.insertInto('site_users').values({ username: 'rate-user', password_hash: 'unused' }).returningAll().executeTakeFirstOrThrow();
  const one = await createApiKey({ userId: user.id, name: 'one' }, db);
  const two = await createApiKey({ userId: user.id, name: 'two' }, db);
  let now = 0;
  const handler = createMcpHandler({ db, env: {}, clock: () => now, log: () => {} });
  const first = connect(handler, one.key); const second = connect(handler, two.key);
  try {
    await first.client.connect(first.transport); await second.client.connect(second.transport);
    for (let i = 0; i < 60; i++) assert.notEqual((await first.client.callTool({ name: 'list_recent_news', arguments: {} })).isError, true);
    assert.equal((await first.client.callTool({ name: 'list_recent_news', arguments: {} })).isError, true);
    assert.notEqual((await second.client.callTool({ name: 'list_recent_news', arguments: {} })).isError, true);
    for (let i = 0; i < 20; i++) assert.equal((await handler(new Request('http://mcp.test', { headers: { 'x-forwarded-for': '192.0.2.1' } }))).status, 401);
    assert.equal((await handler(new Request('http://mcp.test', { headers: { 'x-forwarded-for': '192.0.2.1' } }))).status, 429);
    assert.equal((await handler(new Request('http://mcp.test', { headers: { 'x-forwarded-for': '192.0.2.2' } }))).status, 401);
    now = 60_000;
    assert.equal((await handler(new Request('http://mcp.test', { headers: { 'x-forwarded-for': '192.0.2.1' } }))).status, 401);
    assert.notEqual((await first.client.callTool({ name: 'list_recent_news', arguments: {} })).isError, true);
  } finally { await first.client.close(); await second.client.close(); await db.destroy(); }
});


test('audit persistence failure preserves committed tool results and generated passwords without leaking secrets', async () => {
  const db = new Kysely<Database>({ dialect: new PGliteDialect({ pglite: new PGlite() }) });
  await migrate(db);
  const admin = await db.insertInto('site_users').values({ username: 'audit-admin', password_hash: 'unused', role: 'admin' }).returningAll().executeTakeFirstOrThrow();
  const key = await createApiKey({ userId: admin.id, name: 'audit test' }, db);
  const logs: string[] = [];
  const handler = createMcpHandler({ db, env: {}, log: line => logs.push(line) });
  const { client, transport } = connect(handler, key.key);
  try {
    await client.connect(transport);
    // Fail only audit INSERTs; authentication and tool transactions remain available.
    await sql`ALTER TABLE mcp_audit_log ADD CONSTRAINT reject_audit CHECK (false)`.execute(db);
    const created = await client.callTool({ name: 'create_user', arguments: { username: 'audit-created' } });
    assert.notEqual(created.isError, true);
    const password = output(created).generated_password as string;
    assert.ok(password.length >= 16);
    const row = await db.selectFrom('site_users').selectAll().where('username', '=', 'audit-created').executeTakeFirstOrThrow();
    assert.equal(await verifyPassword(password, row.password_hash), true);
    const started = await client.callTool({ name: 'start_crawl', arguments: { pages: 1 } });
    assert.notEqual(started.isError, true);
    const taskId = output(started).task_id;
    assert.equal(typeof taskId, 'string');
    const cancelled = await client.callTool({ name: 'cancel_crawl', arguments: { task_id: taskId } });
    assert.notEqual(cancelled.isError, true);
    assert.equal(output(cancelled).state, 'cancelled');
    const denied = await client.callTool({ name: 'create_user', arguments: { username: 'ab' } });
    assert.equal(denied.isError, true);
    assert.match(String(output(denied).error), /参数无效/);
    const failures = logs.map(line => JSON.parse(line)).filter(line => line.event === 'mcp_audit_write_failed');
    assert.equal(failures.length, 4);
    assert.ok(failures.every(line => line.key_prefix === key.key_prefix && line.api_key_id === key.id && line.user_id === admin.id));
    const serialized = logs.join('');
    assert.equal(serialized.includes(password), false);
    assert.equal(serialized.includes(key.key), false);
    assert.equal(serialized.includes('reject_audit'), false);
  } finally { await client.close(); await db.destroy(); }
});
