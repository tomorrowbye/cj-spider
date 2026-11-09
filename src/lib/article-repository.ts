import 'server-only';
import { type Insertable, type Kysely, type Updateable, type Selectable } from 'kysely';
import { getDb, serializeRow, type Database, type CrawlSessionTable, type ExportHistoryTable } from './db';
import type { ArticleDetail, ArticleListItem } from './crawl/types';

type Db = Kysely<Database>;
export async function insertArticles(articles: ArticleListItem[], db: Db = getDb()): Promise<number> {
  if (!articles.length) return 0;
  const rows = await db.insertInto('news').values(articles.map(a => ({source_id:a.id, title:a.title, source_url:a.link, category:a.topic, publish_time:parseDateTime(a.createdTime), status:'pending' as const}))).onConflict(oc => oc.column('source_id').doNothing()).returning('id').execute();
  return rows.length;
}
export async function updateArticleDetail(detail: ArticleDetail, db: Db = getDb()): Promise<void> {
  await db.updateTable('news').set({title:detail.title, content:detail.content, content_text:detail.contentText, author:detail.author, source_name:detail.source, category:detail.topic, region:detail.area, publish_time:parseDateTime(detail.createdTime), status:'crawled', crawl_time:new Date().toISOString(), raw_html:detail.rawHtml}).where('source_id','=',detail.id).execute();
}
export async function markArticleFailed(id: string, error: string, db: Db = getDb()): Promise<void> {
  await db.updateTable('news').set({status:'failed',error_message:error}).where('source_id','=',id).execute();
}
export async function getArticle(id: string, db: Db = getDb()) {
  return serializeRow(await db.selectFrom('news').selectAll().where('source_id','=',id).executeTakeFirst() ?? null);
}
export async function getPendingArticles(limit = 100, db: Db = getDb()): Promise<{source_id:string;source_url:string}[]> {
  const rows = await db.selectFrom('news').select(['source_id','source_url']).where('status','=','pending').orderBy('created_at','asc').limit(limit).execute();
  return rows.map(row => ({...row, source_url:row.source_url ?? ''}));
}
export async function getPendingArticlesCount(db: Db = getDb()): Promise<number> {
  const row = await db.selectFrom('news').select(eb=>eb.fn.countAll().as('count')).where('status','=','pending').executeTakeFirstOrThrow();
  return Number(row.count);
}
export async function getExistingArticleIds(ids: string[], db: Db = getDb()): Promise<Set<string>> {
  if (!ids.length) return new Set();
  return new Set((await db.selectFrom('news').select('source_id').where('source_id','in',ids).execute()).map(r=>r.source_id));
}
export async function getNewsStats(db: Db = getDb()) {
  const rows = await db.selectFrom('news').select(['status',eb=>eb.fn.countAll().as('count')]).groupBy('status').execute();
  const result = {total:0,pending:0,crawled:0,failed:0};
  for (const row of rows) { const count=Number(row.count); result.total+=count; if (row.status in result) result[row.status]+=count; }
  return result;
}
export async function resetFailedArticles(db: Db = getDb()): Promise<number> {
  const result = await db.updateTable('news').set({status:'pending',error_message:null}).where('status','=','failed').executeTakeFirst();
  return Number(result.numUpdatedRows);
}
export async function createCrawlSession(config: {sessionName:string;totalPages:number}, db: Db = getDb()): Promise<string> {
  const row = await db.insertInto('crawl_sessions').values({session_name:config.sessionName,total_pages:config.totalPages}).returning('id').executeTakeFirstOrThrow();
  return String(row.id);
}
export async function updateCrawlSession(sessionId: string, updates: {currentPage?:number;totalNews?:number;crawledNews?:number;failedNews?:number;pendingNews?:number;phase?:'list'|'detail'|'completed';avgSpeed?:number;status?:'running'|'paused'|'completed'|'failed'}, db: Db = getDb()): Promise<void> {
  const values: Updateable<CrawlSessionTable> = {};
  if (updates.currentPage!==undefined) values.current_page=updates.currentPage;
  if (updates.totalNews!==undefined) values.total_news=updates.totalNews;
  if (updates.crawledNews!==undefined) values.crawled_news=updates.crawledNews;
  if (updates.failedNews!==undefined) values.failed_news=updates.failedNews;
  if (updates.pendingNews!==undefined) values.pending_news=updates.pendingNews;
  if (updates.phase!==undefined) values.phase=updates.phase;
  if (updates.avgSpeed!==undefined) values.avg_speed=updates.avgSpeed;
  if (updates.status!==undefined) { values.status=updates.status; if (updates.status==='completed'||updates.status==='failed') values.finished_at=new Date().toISOString(); }
  if (!Object.keys(values).length) return;
  await db.updateTable('crawl_sessions').set(values).where('id','=',Number(sessionId)).execute();
}
export async function getCrawlSession(id: string, db: Db = getDb()) {
  return serializeRow(await db.selectFrom('crawl_sessions').selectAll().where('id','=',Number(id)).executeTakeFirst() ?? null);
}
export async function getLatestCrawlSession(db: Db = getDb()) {
  return serializeRow(await db.selectFrom('crawl_sessions').selectAll().where('status','in',['running','paused']).orderBy('started_at','desc').limit(1).executeTakeFirst() ?? null);
}
export async function getCrawlHistory(params: {page?:number;pageSize?:number;status?:string}, db: Db = getDb()) {
  let query=db.selectFrom('crawl_sessions');
  if (params.status && params.status!=='all') query=query.where('status','=',params.status as Selectable<CrawlSessionTable>['status']);
  const {count}=await query.select(eb=>eb.fn.countAll().as('count')).executeTakeFirstOrThrow();
  let rows=query.selectAll().orderBy('started_at','desc');
  if (params.page!==undefined && params.pageSize!==undefined) rows=rows.limit(params.pageSize).offset((params.page-1)*params.pageSize);
  return {data:serializeRow(await rows.execute()),total:Number(count)};
}
export async function recordExport(values: Insertable<ExportHistoryTable>, db: Db = getDb()): Promise<void> {
  await db.insertInto('export_history').values(values).execute();
}
export async function getExportHistory(page: number, pageSize: number, db: Db = getDb()) {
  const {count}=await db.selectFrom('export_history').select(eb=>eb.fn.countAll().as('count')).executeTakeFirstOrThrow();
  const data=await db.selectFrom('export_history').selectAll().orderBy('created_at','desc').limit(pageSize).offset((page-1)*pageSize).execute();
  return {data:serializeRow(data),total:Number(count)};
}
export async function deleteExportHistory(id: string, db: Db = getDb()): Promise<void> {
  await db.deleteFrom('export_history').where('id','=',Number(id)).execute();
}

/** CJ wall-clock strings use +08:00; preserve PR1 parsing semantics. */
export function parseDateTime(dateStr: string): string | null {
  if (!dateStr) return null;
  const trimmed = dateStr.trim();
  const hasTimezone = /([zZ]|[+-]\d{2}:?\d{2})$/.test(trimmed);
  if (hasTimezone) {
    const date = new Date(trimmed);
    return isNaN(date.getTime()) ? null : date.toISOString();
  }
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (match) {
    const [, year, month, day, hour, minute, second] = match;
    return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}+08:00`).toISOString();
  }
  const dateOnly = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    const [, year, month, day] = dateOnly;
    return new Date(`${year}-${month}-${day}T00:00:00+08:00`).toISOString();
  }
  return null;
}
