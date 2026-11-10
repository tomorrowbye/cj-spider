import 'server-only';
import { shanghaiDate } from './shanghai-date';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Kysely } from 'kysely';
import { z } from 'zod';
import { getDb, type Database } from './db';
import { parseDateTime } from './article-repository';
import {
  buildNewsWorkbook, buildCrawlHistoryWorkbook, countNewsForExport, countCrawlHistoryForExport,
  recordNewsExport, ExportError, EXPORT_MAX_ROWS, NEWS_COLUMN_DEFINITIONS,
  CRAWL_HISTORY_COLUMN_DEFINITIONS, DEFAULT_NEWS_COLUMNS, DEFAULT_CRAWL_HISTORY_COLUMNS,
  type NewsExportParams, type CrawlHistoryExportParams,
} from './export-service';

export interface ExportLinkOptions {
  db?: Kysely<Database>;
  now?: () => Date;
  publicBaseUrl?: string;
}
export interface CreateExportLinkInput {
  kind: 'news' | 'crawl_history';
  params: NewsExportParams | CrawlHistoryExportParams;
  columns?: readonly string[];
  userId: number;
  apiKeyId?: number | null;
}
export interface ExportLinkResult {
  download_url: string; file_name: string; row_count: number; expires_at: string;
  max_downloads: number; columns: string[];
}
const text = z.string().max(500);
const date = z.string().max(100).refine(value => {
  const parsed = parseDateTime(value);
  if (!parsed || !Number.isFinite(new Date(parsed).getTime())) return false;
  // Reject impossible dates rather than allowing Date's rollover normalization.
  const day = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day;
}, 'Invalid date');
const newsFilters = z.object({
  keyword: text.optional(), title: text.optional(), author: text.optional(), region: text.optional(),
  sourceName: text.optional(), category: text.optional(), startDate: date.optional(), endDate: date.optional(),
  status: z.enum(['pending', 'crawled', 'failed']).optional(),
  orderBy: z.enum(['id','source_id','title','author','source_name','region','category','publish_time','status','created_at','updated_at','crawl_time','view_count','share_count']).optional(),
  order: z.enum(['asc', 'desc']).optional(),
}).strict().refine(v => !v.startDate || !v.endDate || new Date(parseDateTime(v.startDate)!).getTime() <= new Date(parseDateTime(v.endDate)!).getTime(), 'Invalid date range');
const crawlFilters = z.object({ status: z.enum(['all','running','paused','completed','failed','cancelled']).optional() }).strict();
function validated(kind: CreateExportLinkInput['kind'], params: unknown, columns?: readonly string[]) {
  if (kind !== 'news' && kind !== 'crawl_history') throw new Error('Invalid export kind');
  const filters = kind === 'news' ? newsFilters.parse(params) : crawlFilters.parse(params);
  const definitions = kind === 'news' ? NEWS_COLUMN_DEFINITIONS : CRAWL_HISTORY_COLUMN_DEFINITIONS;
  const selected = z.array(z.string().refine(c => Object.hasOwn(definitions, c))).min(1)
    .refine(c => new Set(c).size === c.length).parse(columns ?? (kind === 'news' ? DEFAULT_NEWS_COLUMNS : DEFAULT_CRAWL_HISTORY_COLUMNS));
  return { filters, columns: selected };
}
function baseUrl(options: ExportLinkOptions): URL {
  const url = new URL(options.publicBaseUrl ?? process.env.PUBLIC_BASE_URL ?? 'https://spider.wakaja.top');
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Invalid PUBLIC_BASE_URL');
  return url;
}
function shanghaiIso(date: Date): string {
  return `${new Date(date.getTime() + 8 * 3600000).toISOString().slice(0, 19)}+08:00`;
}
/** Validates and counts only: XLSX generation is deferred until a claimed download. */
export async function createExportLink(input: CreateExportLinkInput, options: ExportLinkOptions = {}): Promise<ExportLinkResult> {
  const saved = validated(input.kind, input.params, input.columns);
  const url = baseUrl(options);
  const db = options.db ?? getDb();
  const now = (options.now ?? (() => new Date()))();
  const expires = new Date(now.getTime() + 30 * 60000);
  const raw = randomBytes(32).toString('base64url');
  const hash = createHash('sha256').update(raw).digest('hex');
  const filename = `${input.kind === 'news' ? 'news_export' : 'crawl_history'}_${shanghaiDate(now)}.xlsx`;
  const rowCount = await db.transaction().execute(async trx => {
    const user = await trx.selectFrom('site_users').select('id').where('id', '=', input.userId).where('is_active', '=', true).executeTakeFirst();
    if (!user) throw new Error('Account unavailable');
    const count = input.kind === 'news'
      ? await countNewsForExport(saved.filters, trx)
      : await countCrawlHistoryForExport(saved.filters, trx);
    if (count === 0) throw new ExportError('NO_DATA');
    if (count > EXPORT_MAX_ROWS) throw new ExportError('TOO_MANY_ROWS');
    await trx.deleteFrom('export_links').where('expires_at', '<', new Date(now.getTime() - 24 * 3600000).toISOString()).execute();
    if (input.kind === 'news') await recordNewsExport(saved.filters, saved.columns, { filename, rowCount: count }, trx);
    await trx.insertInto('export_links').values({
      user_id: input.userId, api_key_id: input.apiKeyId ?? null, kind: input.kind,
      params: JSON.stringify(saved), token_hash: hash, token_prefix: raw.slice(0, 8),
      row_count: count, file_name: filename, expires_at: expires, created_at: now,
    }).execute();
    return count;
  });
  return { download_url: new URL(`/api/exports/download/${raw}`, url).href,
    file_name: filename, row_count: rowCount, expires_at: shanghaiIso(expires), max_downloads: 3, columns: saved.columns };
}
const privateHeaders = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };
function notFound(): Response { return new Response('Not Found', { status: 404, headers: privateHeaders }); }
/** Public bearer capability. Invalid links and internal failures deliberately share one response. */
export async function downloadExport(token: string, options: ExportLinkOptions = {}): Promise<Response> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token) || Buffer.from(token, 'base64url').toString('base64url') !== token) return notFound();
  try {
    const hash = createHash('sha256').update(token).digest('hex');
    const db = options.db ?? getDb();
    const now = (options.now ?? (() => new Date()))();
    const link = await db.selectFrom('export_links').selectAll().where('token_hash', '=', hash).executeTakeFirst();
    const storedHash = Buffer.from(link?.token_hash ?? '0'.repeat(64), 'hex');
    if (storedHash.length !== 32 || !timingSafeEqual(Buffer.from(hash, 'hex'), storedHash) || !link) return notFound();
    // UPDATE is the atomic slot claim; predicates are rechecked under PostgreSQL row locking.
    const claimed = await db.updateTable('export_links').set(eb => ({ download_count: eb('download_count', '+', 1) }))
      .where('id', '=', link.id).where('expires_at', '>', now.toISOString())
      .whereRef('download_count', '<', 'max_downloads')
      .where(eb => eb.exists(eb.selectFrom('site_users').select('id').whereRef('site_users.id', '=', 'export_links.user_id').where('is_active', '=', true)))
      .where(eb => eb.or([
        eb('api_key_id', 'is', null),
        eb.exists(eb.selectFrom('api_keys').select('id')
          .whereRef('api_keys.id', '=', 'export_links.api_key_id')
          .where('revoked_at', 'is', null)
          .where(key => key.or([key('expires_at', 'is', null), key('expires_at', '>', now.toISOString())]))),
      ]))
      .returning('id').executeTakeFirst();
    if (!claimed) return notFound();
    const stored = z.object({ filters: z.unknown(), columns: z.array(z.string()) }).strict().parse(link.params);
    const saved = validated(link.kind, stored.filters, stored.columns);
    const workbook = link.kind === 'news'
      ? await buildNewsWorkbook(saved.filters, saved.columns, db)
      : await buildCrawlHistoryWorkbook(saved.filters, saved.columns, db);
    return new Response(new Uint8Array(workbook.buffer), { headers: {
      ...privateHeaders, 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(link.file_name)}`,
    } });
  } catch { return notFound(); }
}
/** Kept outside the route module so Next.js only sees supported route exports. */
export function createDownloadHandler(options: ExportLinkOptions = {}) {
  return async (_request: Request, context: { params: Promise<{ token: string }> }): Promise<Response> => {
    try { return await downloadExport((await context.params).token, options); }
    catch { return notFound(); }
  };
}
