import type { Kysely } from 'kysely';
import type { Database } from '../db';
import { getNewsList, type NewsSearchParams } from '../news-service';

export async function latestTaskId(db: Kysely<Database>) {
  const row = await db.selectFrom('crawl_sessions').select('id').orderBy('started_at', 'desc').orderBy('id', 'desc').executeTakeFirst();
  return row ? String(row.id) : null;
}
export async function writeAudit(db: Kysely<Database>, row: { user_id: number; api_key_id: number; tool: string; args_redacted: Record<string, unknown>; ok: boolean; error: string | null; duration_ms: number; task_id: number | null }) {
  await db.insertInto('mcp_audit_log').values({ ...row, args_redacted: JSON.stringify(row.args_redacted) }).execute();
}
export async function recentNews(params: NewsSearchParams, db: Kysely<Database>) {
  const { data } = await getNewsList(params, db);
  const ids = data.map(row => row.source_id);
  const urls = ids.length ? await db.selectFrom('news').select(['source_id', 'source_url']).where('source_id', 'in', ids).execute() : [];
  const byId = new Map(urls.map(row => [row.source_id, row.source_url]));
  return data.map(({ source_id, title, author, source_name, region, publish_time }) => ({ source_id, title, author, source_name, region, publish_time, url: byId.get(source_id) ?? null }));
}
