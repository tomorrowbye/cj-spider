import 'server-only';
import { sql, type Kysely } from 'kysely';
import { getDb, type Database } from './db';

/** Internal server API only. Never include the returned cookie in tool/HTTP output. */
export async function getCurrentCjSession(db: Kysely<Database> = getDb()) {
  return await db.selectFrom('login_sessions').selectAll()
    .where('is_valid', '=', true).where('cookies', 'is not', null)
    .where('expires_at', '>', sql<string>`now()`)
    .orderBy('created_at', 'desc').orderBy('id', 'desc').executeTakeFirst() ?? null;
}
export async function saveCjSession(cookie: string, expiresAt: Date, db: Kysely<Database> = getDb()) {
  if (!cookie || expiresAt.getTime() <= Date.now()) throw new Error('Invalid CJ session');
  return db.insertInto('login_sessions').values({ cookies: cookie, expires_at: expiresAt, is_valid: true })
    .returningAll().executeTakeFirstOrThrow();
}
export async function invalidateCjSession(id: number, db: Kysely<Database> = getDb()): Promise<void> {
  await db.updateTable('login_sessions').set({ is_valid: false }).where('id', '=', id).execute();
}
