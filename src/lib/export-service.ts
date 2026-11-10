import 'server-only';
import { shanghaiDate } from './shanghai-date';
import * as XLSX from 'xlsx';
import type { Kysely, Selectable } from 'kysely';
import { getDb, serializeRow, type Database, type CrawlSessionTable } from './db';
import { countNewsForExport, getNewsForExport, type NewsSearchParams } from './news-service';
import { parseDateTime, recordExport, getExportHistory, deleteExportHistory } from './article-repository';

export { countNewsForExport };
export const EXPORT_MAX_ROWS = 20000;
export type NewsExportParams = Omit<NewsSearchParams, 'page' | 'pageSize'>;
export interface CrawlHistoryExportParams { status?: string }
export interface WorkbookResult { buffer: Buffer; filename: string; rowCount: number }
export type ExportErrorCode = 'NO_DATA' | 'TOO_MANY_ROWS';
export class ExportError extends Error {
  constructor(public readonly code: ExportErrorCode) {
    super(code === 'NO_DATA' ? '没有可导出的数据' : '导出数据超过 20000 条，请缩小日期范围或增加筛选条件');
    this.name = 'ExportError';
  }
}
export const NEWS_COLUMN_DEFINITIONS = {
  source_id: { header: '文章ID', width: 15 },
  title: { header: '标题', width: 50 },
  author: { header: '作者', width: 15 },
  source_name: { header: '来源', width: 20 },
  region: { header: '地区', width: 15 },
  publish_time: { header: '发布时间', width: 20 },
  status: { header: '状态', width: 10 },
  content_text: { header: '内容', width: 100 },
  created_at: { header: '爬取时间', width: 20 },
} as const;
export const CRAWL_HISTORY_COLUMN_DEFINITIONS = {
  id: { header: 'ID', width: 12 },
  session_name: { header: '任务名称', width: 20 },
  total_pages: { header: '总页数', width: 12 },
  current_page: { header: '当前页码', width: 12 },
  total_news: { header: '发现文章数', width: 12 },
  crawled_news: { header: '已爬取数', width: 12 },
  status: { header: '状态', width: 12 },
  started_at: { header: '开始时间', width: 20 },
  finished_at: { header: '完成时间', width: 20 },
  duration: { header: '耗时(分钟)', width: 12 },
  success_rate: { header: '成功率', width: 12 },
} as const;
export type NewsExportColumn = keyof typeof NEWS_COLUMN_DEFINITIONS;
export type CrawlHistoryExportColumn = keyof typeof CRAWL_HISTORY_COLUMN_DEFINITIONS;
export const DEFAULT_NEWS_COLUMNS: readonly NewsExportColumn[] = ['source_id','title','author','source_name','region','publish_time'];
export const DEFAULT_CRAWL_HISTORY_COLUMNS: readonly CrawlHistoryExportColumn[] = ['id','session_name','status','started_at'];
const crawlStatusLabels: Record<string, string> = { running: '运行中', paused: '已暂停', completed: '已完成', failed: '失败', cancelled: '已取消' };
const formatTime = (value: string) => new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

/** Counts and the bounded fetch are both checked: growth cannot create an oversized workbook. */
function assertExportCount(count: number): void {
  if (count === 0) throw new ExportError('NO_DATA');
  if (count > EXPORT_MAX_ROWS) throw new ExportError('TOO_MANY_ROWS');
}
function workbook(rows: Record<string, unknown>[], widths: number[], sheet: string, prefix: string): WorkbookResult {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = widths.map(wch => ({ wch }));
  XLSX.utils.book_append_sheet(wb, ws, sheet);
  return { buffer: XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }), filename: `${prefix}_${shanghaiDate(new Date())}.xlsx`, rowCount: rows.length };
}

/** Pure generation: history belongs to the initiating Web export or MCP link creation. */
export async function buildNewsWorkbook(params: NewsExportParams, columns: readonly string[] = DEFAULT_NEWS_COLUMNS, db = getDb()): Promise<WorkbookResult> {
  assertExportCount(await countNewsForExport(params, db));
  const data = await getNewsForExport(params, db, EXPORT_MAX_ROWS + 1);
  assertExportCount(data.length);
  const rows = data.map(item => {
    const row: Record<string, unknown> = {};
    for (const col of columns) {
      if (!Object.hasOwn(NEWS_COLUMN_DEFINITIONS, col)) continue;
      const key = col as NewsExportColumn;
      let value: unknown = item[key];
      if ((key === 'publish_time' || key === 'created_at') && value) value = formatTime(value as string);
      if (key === 'status') value = value === 'crawled' ? '已爬取' : value === 'pending' ? '待爬取' : '失败';
      row[NEWS_COLUMN_DEFINITIONS[key].header] = value || '';
    }
    return row;
  });
  return workbook(rows, columns.map(col => NEWS_COLUMN_DEFINITIONS[col as NewsExportColumn]?.width || 15), '新闻列表', 'news_export');
}
function crawlQuery(params: CrawlHistoryExportParams, db: Kysely<Database>) {
  let query = db.selectFrom('crawl_sessions');
  if (params.status && params.status !== 'all') query = query.where('status', '=', params.status as Selectable<CrawlSessionTable>['status']);
  return query;
}
export async function countCrawlHistoryForExport(params: CrawlHistoryExportParams, db = getDb()): Promise<number> {
  const { count } = await crawlQuery(params, db).select(eb => eb.fn.countAll().as('count')).executeTakeFirstOrThrow();
  return Number(count);
}
export async function buildCrawlHistoryWorkbook(params: CrawlHistoryExportParams, columns: readonly string[] = DEFAULT_CRAWL_HISTORY_COLUMNS, db = getDb()): Promise<WorkbookResult> {
  assertExportCount(await countCrawlHistoryForExport(params, db));
  const data = serializeRow(await crawlQuery(params, db).selectAll().orderBy('started_at', 'desc').limit(EXPORT_MAX_ROWS + 1).execute());
  assertExportCount(data.length);
  const rows = data.map(item => {
    const row: Record<string, unknown> = {};
    for (const col of columns) {
      const label = CRAWL_HISTORY_COLUMN_DEFINITIONS[col as CrawlHistoryExportColumn]?.header || col;
      switch (col) {
        case 'status': row[label] = crawlStatusLabels[item.status] || item.status; break;
        case 'started_at': case 'finished_at': row[label] = item[col] ? formatTime(item[col]) : '-'; break;
        case 'duration': {
          const end = item.finished_at ? new Date(item.finished_at).getTime() : item.status === 'running' ? Date.now() : null;
          const minutes = end !== null && item.started_at ? Math.round((end - new Date(item.started_at).getTime()) / 60000 * 10) / 10 : null;
          row[label] = minutes === null ? '-' : item.finished_at ? minutes : `${minutes} (进行中)`;
          break;
        }
        case 'success_rate': row[label] = item.total_news > 0 ? `${Math.round(item.crawled_news / item.total_news * 1000) / 10}%` : '-'; break;
        default: row[label] = item[col as keyof typeof item] ?? '-';
      }
    }
    return row;
  });
  return workbook(rows, columns.map(col => CRAWL_HISTORY_COLUMN_DEFINITIONS[col as CrawlHistoryExportColumn]?.width || 12), '爬取历史', 'crawl_history');
}

/** Accepts a transaction as db so link creation can persist its history atomically. */
export async function recordNewsExport(params: NewsExportParams, columns: readonly string[], result: Pick<WorkbookResult, 'filename' | 'rowCount'>, db = getDb()): Promise<void> {
  await recordExport({ keyword: params.keyword || null, author: params.author || null, region: params.region || null,
    source_name: params.sourceName || null, start_date: params.startDate ? parseDateTime(params.startDate) : null,
    end_date: params.endDate ? parseDateTime(params.endDate) : null, total_count: result.rowCount, columns: [...columns], file_name: result.filename }, db);
}
export const listExportHistory = getExportHistory;
export { deleteExportHistory };
