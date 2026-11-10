import 'server-only';
import { sql, type Kysely, type Transaction, type Selectable, type Updateable } from 'kysely';
import { getDb, type Database, type CrawlSessionTable } from './db';

export type CrawlSession = Selectable<CrawlSessionTable>;
export type CrawlUpdate = Omit<Updateable<CrawlSessionTable>, 'recent_titles'> & {
  recent_titles?: Updateable<CrawlSessionTable>['recent_titles'] | import('kysely').RawBuilder<import('./crawl/types').RecentTitle[]>;
};
export type CrawlDb = Kysely<Database>;

/** Serializes global reservations AND state transitions across Web/MCP callers. */
export async function withCrawlLock<T>(db: CrawlDb, fn: (trx: Transaction<Database>) => Promise<T>): Promise<T> {
  return db.transaction().execute(async trx => {
    await sql`LOCK TABLE crawl_sessions IN SHARE ROW EXCLUSIVE MODE`.execute(trx);
    return fn(trx);
  });
}
export async function findCrawl(id: string, db: CrawlDb = getDb()) {
  if (!/^\d+$/.test(id) || !Number.isSafeInteger(Number(id))) return null;
  return await db.selectFrom('crawl_sessions').selectAll().where('id', '=', Number(id)).executeTakeFirst() ?? null;
}
export async function findActiveCrawl(db: CrawlDb = getDb()) {
  return await db.selectFrom('crawl_sessions').selectAll().where('status', 'in', ['running', 'paused'])
    .orderBy('id', 'desc').executeTakeFirst() ?? null;
}

// One promise per process/database: all first accesses await recovery before reserving work.
const recoveries = new WeakMap<CrawlDb, Promise<void>>();
export function recoverCrawls(db: CrawlDb = getDb()): Promise<void> {
  let recovery = recoveries.get(db);
  if (!recovery) {
    recovery = withCrawlLock(db, async trx => {
      await sql`UPDATE crawl_sessions SET
        start_page = COALESCE(start_page, 1), end_page = COALESCE(end_page, GREATEST(total_pages, 1)),
        next_page = COALESCE(next_page, current_page + 1),
        status = CASE WHEN status = 'running' THEN 'paused' ELSE status END,
        pause_reason = CASE WHEN status = 'running' THEN 'server_restart' ELSE pause_reason END,
        execution_id = NULL, updated_at = now()
        WHERE status IN ('running', 'paused')`.execute(trx);
    });
    recoveries.set(db, recovery);
    void recovery.catch(() => { recoveries.delete(db); });
  }
  return recovery;
}

/** Compare execution generation on every runner update; stale runners cannot change lifecycle. */
export async function updateOwnedCrawl(id: string, executionId: string, values: CrawlUpdate, db: CrawlDb) {
  return db.updateTable('crawl_sessions').set({ ...values, updated_at: new Date() })
    .where('id', '=', Number(id)).where('status', '=', 'running').where('execution_id', '=', executionId)
    .returningAll().executeTakeFirst();
}
