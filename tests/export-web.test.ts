import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createRequire } from 'node:module';
import { Kysely, PGliteDialect, sql } from 'kysely';
import { PGlite } from '@electric-sql/pglite';
import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { migrate } from '../db/migrate';
import type { Database } from '../src/lib/db';

const require = createRequire(import.meta.url);
let db: Kysely<Database>;
let denied = false;
require('../src/lib/db.ts'); require('../src/lib/auth-gate.ts');
require.cache[require.resolve('../src/lib/db.ts')]!.exports = { ...require('../src/lib/db.ts'), getDb: () => db };
require.cache[require.resolve('../src/lib/auth-gate.ts')]!.exports = { requireSiteAuth: async () => denied ? NextResponse.json({ error: 'unauthorized' }, { status: 401 }) : null };
const news = require('../src/app/api/news/export/route.ts');
const crawl = require('../src/app/api/crawl/history/export/route.ts');
const history = require('../src/app/api/news/export/history/route.ts');
function request(body: object) { return new NextRequest('http://localhost/export', { method: 'POST', body: JSON.stringify(body) }); }
async function rows(response: Response) { const wb = XLSX.read(Buffer.from(await response.arrayBuffer()), { type: 'buffer' }); return XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]]); }
before(async () => { db = new Kysely<Database>({ dialect: new PGliteDialect({ pglite: new PGlite() }) }); await migrate(db); });
after(async () => { await db.destroy(); });

test('Web crawl exports translate cancelled and use Shanghai timezone', async () => {
  await db.insertInto('crawl_sessions').values({ session_name: 'cancel', total_pages: 1, status: 'cancelled', started_at: '2026-01-01T16:00:00Z' }).execute();
  const response = await crawl.POST(request({ status: 'cancelled' }));
  assert.equal(response.status, 200); assert.match(response.headers.get('content-disposition')!, /^attachment; filename=crawl_history_/);
  const data = await rows(response); assert.deepEqual(Object.keys(data[0]), ['ID','任务名称','状态','开始时间']);
  assert.equal(data[0]['状态'], '已取消');
  assert.equal(data[0]['开始时间'], new Date('2026-01-01T16:00:00Z').toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }));
  assert.equal((await db.selectFrom('export_history').selectAll().execute()).length, 0);
});

test('Web news exports retain defaults/filters, record once, list and delete history', async () => {
  await db.insertInto('news').values([{ source_id: '1', title: 'match', author: 'Alice', region: '北京', source_name: '来源', publish_time: '2026-01-01T16:00:00Z' }, { source_id: '2', title: 'other' }]).execute();
  const response = await news.POST(request({ keyword: 'Ali', author: 'lic', region: '北京', sourceName: '来源', startDate: '2026-01-02', endDate: '2026-01-02' }));
  assert.equal(response.status, 200); assert.match(response.headers.get('content-type')!, /spreadsheetml/); assert.match(response.headers.get('content-disposition')!, /^attachment; filename="news_export_/);
  const data = await rows(response); assert.equal(data.length, 1); assert.deepEqual(Object.keys(data[0]), ['文章ID','标题','作者','来源','地区','发布时间']);
  const listed = await (await history.GET(new NextRequest('http://localhost/history?page=1&pageSize=1'))).json();
  assert.equal(listed.total, 1); assert.equal(listed.pageSize, 1); assert.equal(listed.totalPages, 1); assert.equal(listed.data[0].keyword, 'Ali'); assert.equal(listed.data[0].total_count, 1);
  assert.equal((await history.DELETE(new NextRequest('http://localhost/history', { method: 'DELETE' }))).status, 400);
  assert.equal((await history.DELETE(new NextRequest(`http://localhost/history?id=${listed.data[0].id}`, { method: 'DELETE' }))).status, 200);
  assert.equal((await db.selectFrom('export_history').selectAll().execute()).length, 0);
});

test('Web metadata and auth remain intact on all export methods', async () => {
  assert.equal((await (await news.GET()).json()).columns.length, 9);
  assert.equal((await (await crawl.GET()).json()).columns.length, 11);
  denied = true;
  try {
    for (const invoke of [() => news.GET(), () => news.POST(request({})), () => crawl.GET(), () => crawl.POST(request({})), () => history.GET(new NextRequest('http://localhost/history')), () => history.DELETE(new NextRequest('http://localhost/history?id=1'))]) assert.equal((await invoke()).status, 401);
  } finally { denied = false; }
});

test('Web empty/overflow export errors are 400 and never record history', async () => {
  for (const [route, body] of [[news, { keyword: 'absent' }], [crawl, { status: 'failed' }]] as const) {
    const response = await route.POST(request(body)); assert.equal(response.status, 400); assert.equal((await response.json()).error, '没有可导出的数据');
  }
  await sql`insert into news (source_id,title) select ('bulk-' || n), 'bulk' from generate_series(1,20001) n`.execute(db);
  await sql`insert into crawl_sessions (total_pages,status) select 1,'failed' from generate_series(1,20001)`.execute(db);
  for (const [route, body] of [[news, { keyword: 'bulk' }], [crawl, { status: 'failed' }]] as const) {
    const response = await route.POST(request(body)); assert.equal(response.status, 400); assert.equal((await response.json()).error, '导出数据超过 20000 条，请缩小日期范围或增加筛选条件');
  }
  assert.equal((await db.selectFrom('export_history').selectAll().execute()).length, 0);
});

test('Web news download remains successful if history persistence fails', async () => {
  await sql`drop table export_history`.execute(db);
  const original = console.error; const errors: unknown[][] = []; console.error = (...args) => { errors.push(args); };
  try { const response = await news.POST(request({ keyword: 'match' })); assert.equal(response.status, 200); assert.equal((await rows(response)).length, 1); assert.equal(errors.length, 1); }
  finally { console.error = original; }
});
