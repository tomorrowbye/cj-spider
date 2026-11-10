import { z } from 'zod';
import { NEWS_COLUMN_DEFINITIONS, CRAWL_HISTORY_COLUMN_DEFINITIONS } from '../export-service';

const newsColumns = z.array(z.enum(Object.keys(NEWS_COLUMN_DEFINITIONS) as [keyof typeof NEWS_COLUMN_DEFINITIONS, ...(keyof typeof NEWS_COLUMN_DEFINITIONS)[]])).min(1).transform(v => [...new Set(v)]);
const crawlColumns = z.array(z.enum(Object.keys(CRAWL_HISTORY_COLUMN_DEFINITIONS) as [keyof typeof CRAWL_HISTORY_COLUMN_DEFINITIONS, ...(keyof typeof CRAWL_HISTORY_COLUMN_DEFINITIONS)[]])).min(1).transform(v => [...new Set(v)]);
const page = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
export const startSchema = z.object({
  pages: page.max(100).optional(), start_page: page.optional(), end_page: page.optional(),
  skip_existing: z.boolean().default(true), idempotency_key: z.string().min(1).max(200).optional(),
}).strict().superRefine((v, ctx) => {
  const valid = v.pages !== undefined
    ? v.start_page === undefined && v.end_page === undefined
    : v.start_page !== undefined && v.end_page !== undefined && v.end_page >= v.start_page && v.end_page - v.start_page < 100;
  if (!valid) ctx.addIssue({ code: 'custom', message: '请选择 pages 或 start_page/end_page，范围最多 100 页' });
});
export const taskSchema = z.object({ task_id: z.string().regex(/^[1-9]\d*$/).max(16).optional() }).strict();
export const createUserSchema = z.object({ username: z.string().min(3).max(50), password: z.string().min(4).optional(), role: z.enum(['user', 'admin']).default('user') }).strict();
export const emptySchema = z.object({}).strict();
export const submitSchema = z.object({ code: z.string().min(4).max(6), login_session_id: z.string().min(1).max(200) }).strict();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
}, '日期无效');
export const exportNewsSchema = z.object({
  keyword: z.string().max(200).optional(), author: z.string().max(200).optional(),
  region: z.string().max(200).optional(), source_name: z.string().max(200).optional(),
  start_date: date.optional(), end_date: date.optional(), columns: newsColumns.optional(),
  include_content: z.boolean().optional(),
}).strict().refine(v => !v.start_date || !v.end_date || v.start_date <= v.end_date, '开始日期不得晚于结束日期');
export const exportCrawlHistorySchema = z.object({
  status: z.enum(['running', 'paused', 'completed', 'failed', 'cancelled']).optional(),
  columns: crawlColumns.optional(),
}).strict();
export const listExportHistorySchema = z.object({ limit: z.number().int().min(1).max(50).default(10) }).strict();
export const newsSchema = z.object({ limit: z.number().int().min(1).max(50).default(20), start_date: date.optional(), end_date: date.optional(), keyword: z.string().max(200).optional() }).strict().refine(v => !v.start_date || !v.end_date || v.start_date <= v.end_date, '开始日期不得晚于结束日期');
