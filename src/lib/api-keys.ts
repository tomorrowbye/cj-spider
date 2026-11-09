import 'server-only';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import { getDb, serializeRow, type Database } from './db';

export interface ApiKeyMetadata {
  id: number; name: string; key_prefix: string; created_at: string;
  last_used_at: string | null; expires_at: string | null; revoked_at: string | null;
}
export interface ApiKeyIdentity {
  user: { id: number; username: string; role: 'admin' | 'user'; is_active: boolean };
  apiKey: { id: number; key_prefix: string };
}
export class ApiKeyError extends Error {
  constructor(message: string, public readonly status = 400) { super(message); }
}
const metadataColumns = ['id', 'name', 'key_prefix', 'created_at', 'last_used_at', 'expires_at', 'revoked_at'] as const;
const hashKey = (key: string) => createHash('sha256').update(key).digest();
const dummyHash = hashKey('api-key-unknown-prefix-dummy');

/** The complete key is returned once; only its SHA-256 digest is persisted. */
export async function createApiKey(
  { userId, name, expiresInDays }: { userId: number; name: string; expiresInDays?: number },
  db: Kysely<Database> = getDb(),
): Promise<ApiKeyMetadata & { key: string }> {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 100) throw new ApiKeyError('名称长度应为1-100个字符');
  if (expiresInDays !== undefined && (!Number.isSafeInteger(expiresInDays) || expiresInDays < 1 || expiresInDays > 36500)) throw new ApiKeyError('有效期应为1-36500天的整数');
  const result = await db.transaction().execute(async trx => {
    // A per-user row lock serializes concurrent creations, including the cap check.
    const user = await trx.selectFrom('site_users').select(['id', 'is_active']).where('id', '=', userId).forUpdate().executeTakeFirst();
    if (!user?.is_active) throw new ApiKeyError('未登录', 401);
    const count = await trx.selectFrom('api_keys').select(({ fn }) => fn.countAll<string>().as('count')).where('user_id', '=', userId).where('revoked_at', 'is', null).executeTakeFirstOrThrow();
    if (Number(count.count) >= 10) throw new ApiKeyError('每个用户最多10个未吊销的API Key');
    const prefix = randomBytes(4).toString('hex');
    const key = `cjsk_${prefix}_${randomBytes(32).toString('base64url')}`;
    const row = await trx.insertInto('api_keys').values({ user_id: userId, name: name.trim(), key_prefix: prefix, key_hash: hashKey(key).toString('hex'), expires_at: expiresInDays === undefined ? null : new Date(Date.now() + expiresInDays * 86400000).toISOString(), last_used_at: null, revoked_at: null }).returning(metadataColumns).executeTakeFirstOrThrow();
    return { ...serializeRow(row), key };
  });
  console.info(JSON.stringify({ event: 'api_key_created', actor_user_id: userId, key_prefix: result.key_prefix, at: new Date().toISOString() }));
  return result;
}

export async function authenticateApiKey(header: string | null, db: Kysely<Database> = getDb()): Promise<ApiKeyIdentity | null> {
  const match = header?.match(/^Bearer (cjsk_([a-f0-9]{8})_[A-Za-z0-9_-]{43})$/i);
  if (!match) return null;
  const row = await db.selectFrom('api_keys').selectAll().where('key_prefix', '=', match[2]).executeTakeFirst();
  const stored = row && /^[a-f0-9]{64}$/.test(row.key_hash) ? Buffer.from(row.key_hash, 'hex') : dummyHash;
  // Always compare equal-sized digests, even when no prefix exists.
  const valid = timingSafeEqual(hashKey(match[1]), stored);
  if (!row || !valid || row.revoked_at || (row.expires_at && new Date(row.expires_at).getTime() <= Date.now())) return null;
  const user = await db.selectFrom('site_users').select(['id', 'username', 'role', 'is_active']).where('id', '=', row.user_id).executeTakeFirst();
  if (!user?.is_active) return null;
  await db.updateTable('api_keys').set({ last_used_at: sql<string>`now()` }).where('id', '=', row.id)
    .where(eb => eb.or([eb('last_used_at', 'is', null), eb('last_used_at', '<', sql<string>`now() - interval '60 seconds'`)])).execute();
  return { user, apiKey: { id: row.id, key_prefix: row.key_prefix } };
}

export async function listApiKeys(actor: ApiKeyIdentity['user'], all = false, db: Kysely<Database> = getDb()): Promise<(ApiKeyMetadata & { username?: string })[]> {
  if (!actor.is_active) throw new ApiKeyError('未登录', 401);
  if (all && actor.role !== 'admin') throw new ApiKeyError('权限不足', 403);
  if (all) return serializeRow(await db.selectFrom('api_keys as k').innerJoin('site_users as u', 'u.id', 'k.user_id').select(metadataColumns.map(column => `k.${column}` as const)).select('u.username').orderBy('k.id', 'desc').execute());
  return serializeRow(await db.selectFrom('api_keys').select(metadataColumns).where('user_id', '=', actor.id).orderBy('id', 'desc').execute());
}

export async function revokeApiKey(id: number, actor: ApiKeyIdentity['user'], db: Kysely<Database> = getDb()): Promise<void> {
  if (!actor.is_active) throw new ApiKeyError('未登录', 401);
  if (!Number.isSafeInteger(id) || id < 1) throw new ApiKeyError('无效的Key ID');
  let query = db.updateTable('api_keys').set({ revoked_at: sql<string>`COALESCE(revoked_at, now())` }).where('id', '=', id);
  if (actor.role !== 'admin') query = query.where('user_id', '=', actor.id);
  const row = await query.returning('key_prefix').executeTakeFirst();
  if (!row) throw new ApiKeyError('API Key不存在', 404);
  console.info(JSON.stringify({ event: 'api_key_revoked', actor_user_id: actor.id, key_prefix: row.key_prefix, at: new Date().toISOString() }));
}
