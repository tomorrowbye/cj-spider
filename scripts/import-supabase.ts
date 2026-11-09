/**
 * Run after db:migrate:
 * node --conditions=react-server --import tsx scripts/import-supabase.ts
 * Required: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL.
 * Freeze ALL source writes (including crawlers/logins) for the entire import and
 * verification. REST has no cross-request snapshot: count rechecks detect count
 * changes, but cannot detect equal-count replacements or in-place edits.
 * Stop target writers too. No credentials or source row contents are logged.
 */
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { sql, type Kysely } from 'kysely';
import type { Database } from '../src/lib/db';

const columns = {
  news: 'id source_id title content content_text summary author source_name region category tags view_count share_count images qr_codes contact_info related_links source_url publish_time crawl_time status error_message raw_html created_at updated_at',
  site_users: 'id username password_hash role is_active created_at updated_at last_login_at',
  crawl_sessions: 'id session_name total_pages current_page total_news crawled_news failed_news pending_news phase avg_speed status started_at finished_at',
  export_history: 'id keyword author region source_name start_date end_date total_count columns file_name created_at',
  crawl_tasks: 'id task_type target_url page_num news_source_id status retry_count error_message created_at completed_at',
  login_sessions: 'id cookies user_agent is_valid created_at expires_at',
  auth_identities: 'id user_id provider provider_subject created_at',
} as const;
type Table = Exclude<keyof typeof columns, 'auth_identities'>;
type Row = Record<string, unknown>;
export type SourceData = Record<Table, Row[]>;
const tables = Object.keys(columns).filter(t => t !== 'auth_identities') as Table[];
const optional = new Set<Table>(['crawl_tasks', 'login_sessions']);
const jsonColumns = new Set(['images', 'qr_codes', 'contact_info', 'related_links']);
const dateColumns = new Set(['publish_time', 'crawl_time', 'created_at', 'updated_at', 'last_login_at', 'started_at', 'finished_at', 'start_date', 'end_date', 'completed_at', 'expires_at']);
export interface ImportOptions {
  url: string;
  serviceKey: string;
  fetcher?: typeof fetch;
  pageSize?: number;
  warn?: (message: string) => void;
}
function fail(message: string): never { throw new Error(message); }
function validateColumns(table: keyof typeof columns, names: string[]) {
  const allowed = new Set(columns[table].split(' '));
  if (names.some(n => !allowed.has(n))) fail(`Unmapped column in ${table}; update the schema and importer before proceeding`);
}
function idOf(value: unknown): bigint {
  if ((typeof value === 'number' && Number.isSafeInteger(value)) || (typeof value === 'string' && /^\d+$/.test(value))) {
    const id = BigInt(value);
    if (id > BigInt(0) && id <= BigInt('9223372036854775807')) return id;
  }
  return fail('Invalid or imprecise source ID');
}
function normalize(table: Table, row: Row): Row {
  validateColumns(table, Object.keys(row));
  idOf(row.id);
  return Object.fromEntries(Object.entries(row).map(([key, value]) => {
    if (dateColumns.has(key) && value !== null) {
      if (typeof value !== 'string') fail(`Invalid timestamp in ${table}`);
      // Date-only and timezone-less wall clocks belong to Asia/Shanghai.
      let date = value.trim().replace(' ', 'T');
      if (/^\d{4}-\d{2}-\d{2}$/.test(date)) date += 'T00:00:00';
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(date)) date += '+08:00';
      if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}(?::?\d{2})?)$/i.test(date) || !Number.isFinite(Date.parse(date))) fail(`Invalid timestamp in ${table}`);
      return [key, date];
    }
    return [key, value];
  }));
}
function client(options: ImportOptions) {
  const base = new URL(options.url);
  if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) fail('Invalid SUPABASE_URL');
  if (!options.serviceKey) fail('SUPABASE_SERVICE_ROLE_KEY is required');
  const warn = options.warn ?? console.warn;
  const fetcher = options.fetcher ?? fetch;
  const request = async (path: string, method = 'GET') => {
    try {
      return await fetcher(new URL(`/rest/v1/${path}`, base), {
        method, redirect:'error', signal:AbortSignal.timeout(60_000),
        headers: {apikey:options.serviceKey, Authorization:`Bearer ${options.serviceKey}`, 'Accept-Profile':'public', Prefer:'count=exact'},
      });
    } catch { return fail('Source request failed (details redacted)'); }
  };
  const discovery = async () => {
    const response = await request('');
    if (!response.ok) {
      // Discovery is best-effort; exact count probes below are mandatory.
      warn('WARNING: OpenAPI discovery unavailable; verify public tables manually before importing.');
      return;
    }
    let spec: {paths?:Record<string, unknown>; definitions?:Record<string, {properties?:Record<string, unknown>}>; components?: {schemas?:Record<string, {properties?:Record<string, unknown>}>}};
    try {spec = await response.json();} catch {return fail('Invalid OpenAPI response');}
    if (!spec.paths) fail('OpenAPI response does not describe public tables');
    for (const path of Object.keys(spec.paths)) {
      if (path === '/' || path.startsWith('/rpc/')) continue;
      const table = path.replace(/^\//, '');
      if (!tables.includes(table as Table)) fail('Unmapped public table in OpenAPI; update importer before proceeding');
    }
    for (const [table, schema] of Object.entries(spec.definitions ?? spec.components?.schemas ?? {})) {
      if (tables.includes(table as Table)) validateColumns(table as Table, Object.keys(schema.properties ?? {}));
    }
  };
  const count = async (table: Table): Promise<number | null> => {
    const response = await request(`${table}?select=id`, 'HEAD');
    if (response.status === 404 && optional.has(table)) {
      // A generic 404/proxy failure must not masquerade as an absent table.
      const probe = await request(`${table}?select=id&limit=1`);
      let code: unknown;
      try {code = (await probe.json()).code;} catch { /* fail below */ }
      if (probe.status === 404 && (code === 'PGRST205' || code === '42P01')) return null;
    }
    if (!response.ok) fail(`Cannot read required source table ${table}`);
    const range = response.headers.get('content-range');
    const match = range?.match(/^(?:\*|\d+-\d+)\/(\d+)$/);
    if (!match) fail(`Exact source count unavailable for ${table}`);
    const n = Number(match[1]);
    if (!Number.isSafeInteger(n)) fail(`Invalid source count for ${table}`);
    return n;
  };
  return {request, count, discovery, warn};
}
async function snapshot(options: ImportOptions) {
  const api = client(options);
  const limit = options.pageSize ?? 1000;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10000) fail('Invalid page size');
  await api.discovery();
  const counts = {} as Record<Table, number | null>;
  for (const table of tables) counts[table] = await api.count(table);
  const data = {} as SourceData;
  for (const table of tables) {
    data[table] = [];
    if (counts[table] === null) {
      api.warn(`WARNING: Optional legacy source table ${table} is missing; no rows will be imported.`);
      continue;
    }
    let after: bigint | undefined;
    for (;;) {
      const query = new URLSearchParams({select:'*', order:'id.asc', limit:String(limit)});
      if (after !== undefined) query.set('id', `gt.${after}`);
      const response = await api.request(`${table}?${query}`);
      if (!response.ok) fail(`Source page request failed for ${table}`);
      let rows: unknown;
      try {rows = await response.json();} catch {return fail(`Invalid source page for ${table}`);}
      if (!Array.isArray(rows)) fail(`Invalid source page for ${table}`);
      if (rows.length === 0) break;
      for (const row of rows) {
        if (row === null || typeof row !== 'object' || Array.isArray(row)) fail(`Invalid source row for ${table}`);
        const id = idOf(row.id);
        if (after !== undefined && id <= after) fail(`Non-increasing source IDs for ${table}`);
        after = id;
        data[table].push(normalize(table, row));
      }
      if (data[table].length > counts[table]!) fail(`Source count changed for ${table}; freeze source writes`);
      // Never stop at a short page: PostgREST may cap results below our limit.
    }
    if (data[table].length !== counts[table]) fail(`Source count mismatch for ${table}; freeze source writes`);
  }
  const recheck = async () => {
    for (const table of tables) if (await api.count(table) !== counts[table]) fail(`Source count changed for ${table}; freeze source writes`);
  };
  await recheck();
  return {data, recheck};
}
export async function readSource(options: ImportOptions): Promise<SourceData> {return (await snapshot(options)).data;}

export async function importSupabase(db: Kysely<Database>, options: ImportOptions): Promise<Record<Table, number>> {
  const {data, recheck} = await snapshot(options);
  return db.transaction().execute(async trx => {
    await sql`SET LOCAL TIME ZONE 'Asia/Shanghai'`.execute(trx);
    // Prevent concurrent target writes between ID validation and final counts.
    await sql`LOCK TABLE ${sql.join(Object.keys(columns).map(n=>sql.table(n)))} IN SHARE ROW EXCLUSIVE MODE`.execute(trx);
    const schema = await sql<{table_name:string; column_name:string}>`select table_name, column_name from information_schema.columns where table_schema='public'`.execute(trx);
    for (const table of Object.keys(columns) as (keyof typeof columns)[]) {
      const actual = schema.rows.filter(r=>r.table_name===table).map(r=>r.column_name);
      validateColumns(table, actual);
      if (columns[table].split(' ').some(n=>!actual.includes(n))) fail(`Missing target column in ${table}`);
    }
    for (const table of tables) {
      const ids = new Set(data[table].map(r=>String(r.id)));
      const existing = await sql<{id:string}>`select id::text as id from ${sql.table(table)}`.execute(trx);
      if (existing.rows.some(r=>!ids.has(r.id))) fail(`Target ${table} contains extra IDs; use a clean target or reconcile explicitly`);
    }
    const triggers = await sql<{tgname:string; tgenabled:string; table_name:string}>`
      select t.tgname, t.tgenabled, c.relname as table_name from pg_trigger t
      join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and not t.tgisinternal
        and ((c.relname='news' and t.tgname='news_updated_at') or (c.relname='site_users' and t.tgname='site_users_updated_at'))
    `.execute(trx);
    for (const t of triggers.rows) await sql`alter table ${sql.table(t.table_name)} disable trigger ${sql.id(t.tgname)}`.execute(trx);
    for (const table of tables) {
      for (const row of data[table]) {
        const keys = Object.keys(row);
        const values = keys.map(key => jsonColumns.has(key) && row[key] !== null ? sql`${JSON.stringify(row[key])}::jsonb` : sql`${row[key]}`);
        const updates = keys.filter(k=>k!=='id').map(k=>sql`${sql.id(k)} = ${sql.ref(`excluded.${k}`)}`);
        await sql`insert into ${sql.table(table)} (${sql.join(keys.map(k=>sql.id(k)))}) values (${sql.join(values)}) on conflict (id) do update set ${sql.join(updates)}`.execute(trx);
      }
    }
    // Never reassign an existing identity to a different account.
    const identities = await sql<{user_id:string; provider_subject:string}>`select user_id::text as user_id, provider_subject from auth_identities where provider='local'`.execute(trx);
    const users = new Map(data.site_users.map(r=>[String(r.id), r.username]));
    if (identities.rows.some(i=>users.get(i.user_id)!==i.provider_subject)) fail('Target has conflicting local identities');
    await sql`insert into auth_identities (user_id, provider, provider_subject, created_at)
      select id, 'local', username, created_at from site_users
      on conflict (user_id, provider) do nothing`.execute(trx);
    const localCount = await sql<{n:string}>`select count(*)::text as n from auth_identities where provider='local'`.execute(trx);
    if (Number(localCount.rows[0].n) !== data.site_users.length) fail('Local identity count mismatch');
    for (const t of triggers.rows) {
      const mode = {D:'disable', O:'enable', A:'enable always', R:'enable replica'}[t.tgenabled];
      if (!mode) fail('Unknown trigger state');
      await sql`alter table ${sql.table(t.table_name)} ${sql.raw(mode)} trigger ${sql.id(t.tgname)}`.execute(trx);
    }
    const result = {} as Record<Table, number>;
    for (const table of tables) {
      const count = await sql<{n:string}>`select count(*)::text as n from ${sql.table(table)}`.execute(trx);
      result[table] = Number(count.rows[0].n);
      if (result[table] !== data[table].length) fail(`Target count mismatch for ${table}`);
    }
    await recheck();
    for (const table of Object.keys(columns)) {
      const seq = await sql<{name:string | null; next:string}>`select pg_get_serial_sequence(${`public.${table}`}, 'id') as name, (coalesce(max(id), 0)+1)::text as next from ${sql.table(table)}`.execute(trx);
      const {name, next} = seq.rows[0];
      if (!name || !/^\d+$/.test(next)) fail(`Cannot repair sequence for ${table}`);
      // ALTER RESTART rolls back with this transaction; setval does not.
      await sql`alter sequence ${sql.id(...name.split('.').map(s=>s.replace(/^"|"$/g,'')))} restart with ${sql.raw(next)}`.execute(trx);
    }
    return result;
  });
}

async function main() {
  for (const key of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'DATABASE_URL']) if (!process.env[key]) fail(`${key} is required`);
  // Lazy runtime connection: importing helpers never reads env or opens a DB.
  const {getDb, closeDb} = await import('../src/lib/db');
  try {
    console.warn('Freeze all source and target writes until import verification completes.');
    const result = await importSupabase(getDb(), {url:process.env.SUPABASE_URL!, serviceKey:process.env.SUPABASE_SERVICE_ROLE_KEY!});
    for (const [table, count] of Object.entries(result)) console.log(`${table}: source=${count} target=${count}`);
  } finally {await closeDb();}
}
if (process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url) {
  void main().catch(() => {console.error('Import failed; transaction rolled back. Check configuration/schema and freeze writes. Error details suppressed to protect source data and credentials.'); process.exitCode=1;});
}
