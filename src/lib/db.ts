import 'server-only';
import { Kysely, PostgresDialect, type Generated, type ColumnType } from 'kysely';
import { Pool, types } from 'pg';

type Timestamp = ColumnType<string, string | Date, string | Date>;
type DefaultTimestamp = ColumnType<string, string | Date | undefined, string | Date>;
type Json = ColumnType<unknown, unknown, unknown>;
export interface NewsTable {
  id: Generated<number>; source_id: string; title: string;
  content: string | null; content_text: string | null; summary: string | null;
  author: string | null; source_name: string | null; region: string | null; category: string | null;
  tags: string[] | null; view_count: Generated<number>; share_count: Generated<number>;
  images: Json; qr_codes: Json; contact_info: Json; related_links: Json;
  source_url: string | null; publish_time: Timestamp | null; crawl_time: Timestamp | null;
  status: Generated<'pending' | 'crawled' | 'failed'>; error_message: string | null; raw_html: string | null;
  created_at: DefaultTimestamp; updated_at: DefaultTimestamp;
}
export interface CrawlSessionTable {
  id: Generated<number>; session_name: string | null; total_pages: number;
  current_page: Generated<number>; total_news: Generated<number>; crawled_news: Generated<number>;
  failed_news: Generated<number>; pending_news: Generated<number>; avg_speed: Generated<number>;
  phase: Generated<'list' | 'detail' | 'completed'>;
  status: Generated<'running' | 'paused' | 'completed' | 'failed' | 'cancelled'>;
  pause_reason: string | null; start_page: number | null; end_page: number | null; next_page: number | null;
  skip_existing: Generated<boolean>; idempotency_key: string | null;
  recent_titles: Generated<import('./crawl/types').RecentTitle[]>;
  execution_id: string | null; pending_execution: Json; updated_at: DefaultTimestamp;
  started_at: DefaultTimestamp; finished_at: Timestamp | null;
}
export interface SiteUserTable {
  id: Generated<number>; username: string; password_hash: string; role: Generated<'admin' | 'user'>;
  is_active: Generated<boolean>; created_at: DefaultTimestamp; updated_at: DefaultTimestamp; last_login_at: Timestamp | null;
}
export interface ExportHistoryTable {
  id: Generated<number>; keyword: string | null; author: string | null; region: string | null;
  source_name: string | null; start_date: Timestamp | null; end_date: Timestamp | null;
  total_count: number; columns: string[]; file_name: string; created_at: DefaultTimestamp;
}
export interface ExportLinkTable {
  id: Generated<number>; user_id: number; api_key_id: number | null;
  kind: 'news' | 'crawl_history'; params: Json; token_hash: string; token_prefix: string;
  row_count: number; file_name: string; expires_at: Timestamp;
  download_count: Generated<number>; max_downloads: Generated<number>; created_at: DefaultTimestamp;
}
export interface Database {
  export_links: ExportLinkTable;
  api_keys: { id: Generated<number>; user_id: number; name: string; key_prefix: string; key_hash: string; created_at: DefaultTimestamp; last_used_at: Timestamp | null; expires_at: Timestamp | null; revoked_at: Timestamp | null };
  mcp_audit_log: { id: Generated<number>; created_at: DefaultTimestamp; user_id: number | null; api_key_id: number | null; tool: string; args_redacted: Json; ok: boolean; error: string | null; duration_ms: number; task_id: number | null };
  news: NewsTable;
  crawl_sessions: CrawlSessionTable;
  site_users: SiteUserTable;
  auth_identities: { id: Generated<number>; user_id: number; provider: string; provider_subject: string; created_at: DefaultTimestamp };
  export_history: ExportHistoryTable;
  crawl_tasks: { id: Generated<number>; task_type: string; target_url: string; page_num: number | null; news_source_id: string | null; status: Generated<string>; retry_count: Generated<number>; error_message: string | null; created_at: DefaultTimestamp; completed_at: Timestamp | null };
  login_sessions: { id: Generated<number>; cookies: string | null; user_agent: string | null; is_valid: Generated<boolean>; created_at: DefaultTimestamp; expires_at: Timestamp | null };
}

let database: Kysely<Database> | undefined;
/** Runtime-only, lazy singleton. Importing server modules never opens a connection. */
export function getDb(): Kysely<Database> {
  if (!database) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL is required');
    // Keep existing API JSON types: numeric IDs and ISO timestamp strings.
    types.setTypeParser(20, (value) => {
      const number = Number(value);
      if (!Number.isSafeInteger(number)) throw new Error('PostgreSQL bigint exceeds the safe integer range');
      return number;
    });
    types.setTypeParser(1184, (value) => new Date(value).toISOString());
    database = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString, options: '-c timezone=Asia/Shanghai', max: 10 }) }) });
  }
  return database;
}
export async function closeDb(): Promise<void> {
  const db = database;
  database = undefined;
  await db?.destroy();
}

/** PGlite returns Date objects; API/repository values match pg's ISO strings. */
export function serializeRow<T>(row: T): T {
  return JSON.parse(JSON.stringify(row)) as T;
}
