import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Kysely, PGliteDialect, sql, type PluginTransformQueryArgs, type PluginTransformResultArgs, type RootOperationNode } from 'kysely';
import { PGlite } from '@electric-sql/pglite';
import * as XLSX from 'xlsx';
import { migrate } from '../db/migrate';
import type { Database } from '../src/lib/db';
import { getNewsForExport } from '../src/lib/news-service';
import { buildNewsWorkbook, buildCrawlHistoryWorkbook, countNewsForExport, countCrawlHistoryForExport, recordNewsExport, listExportHistory, ExportError, EXPORT_MAX_ROWS } from '../src/lib/export-service';

async function fixture() {
  const db = new Kysely<Database>({ dialect: new PGliteDialect({ pglite: new PGlite() }) });
  await migrate(db);
  return db;
}
function sheet(buffer: Buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellStyles: true });
  return { wb, ws: wb.Sheets[wb.SheetNames[0]], rows: XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]]) };
}
const overflow = '导出数据超过 20000 条，请缩小日期范围或增加筛选条件';

for (const kind of ['news', 'crawl_history'] as const) {
  test(`${kind} workbook filename uses the Shanghai calendar date after UTC 16:00`, async t => {
    const db = await fixture();
    try {
      await db.insertInto('news').values({ source_id: 'date', title: 'Date boundary' }).execute();
      await db.insertInto('crawl_sessions').values({ total_pages: 1 }).execute();
      t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-10T16:30:00Z') });
      const build = kind === 'news' ? buildNewsWorkbook : buildCrawlHistoryWorkbook;
      const result = await build({}, undefined, db);
      assert.equal(result.filename, `${kind === 'news' ? 'news_export' : 'crawl_history'}_2026-11-11.xlsx`);
    } finally {
      t.mock.timers.reset();
      await db.destroy();
    }
  });
}

test('news workbook preserves defaults, ordered columns, widths, content and Shanghai times without recording history', async () => {
  const db = await fixture();
  try {
    await db.insertInto('news').values({ source_id: '001', title: '标题', author: '作者', source_name: '来源', region: '北京', content_text: '正文', status: 'crawled', publish_time: '2026-01-01T16:00:00Z', created_at: '2026-01-01T16:00:00Z' }).execute();
    const result = await buildNewsWorkbook({}, undefined, db);
    assert.equal(result.rowCount, 1); assert.match(result.filename, /^news_export_\d{4}-\d{2}-\d{2}\.xlsx$/);
    const { wb, ws, rows } = sheet(result.buffer);
    assert.deepEqual(wb.SheetNames, ['新闻列表']);
    assert.deepEqual(Object.keys(rows[0]), ['文章ID','标题','作者','来源','地区','发布时间']);
    assert.equal(rows[0]['发布时间'], new Date('2026-01-01T16:00:00Z').toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }));
    assert.equal(Math.round(ws['!cols']![1].wch!), 50);
    const custom = sheet((await buildNewsWorkbook({}, ['content_text','status','created_at'], db)).buffer).rows[0];
    assert.deepEqual(Object.keys(custom), ['内容','状态','爬取时间']); assert.equal(custom['内容'], '正文'); assert.equal(custom['状态'], '已爬取'); assert.equal(custom['爬取时间'], rows[0]['发布时间']);
    assert.equal((await listExportHistory(1, 10, db)).total, 0);
    await recordNewsExport({ keyword: '标题', startDate: '2026-01-02', endDate: '2026-01-02' }, ['title'], result, db);
    const history = await listExportHistory(1, 10, db);
    assert.equal(history.total, 1); assert.equal(history.data[0].file_name, result.filename); assert.equal(history.data[0].total_count, 1); assert.deepEqual(history.data[0].columns, ['title']); assert.equal(history.data[0].start_date, '2026-01-01T16:00:00.000Z');
  } finally { await db.destroy(); }
});

test('news counts and bounded fetch share all filters and microsecond-safe date boundaries', async () => {
  const db = await fixture();
  try {
    await sql`insert into news (source_id,title,author,region,source_name,category,status,publish_time) select n::text, 'match', 'Alice', '北京', '来源', '分类', 'crawled', t::timestamptz from (values (1,'2026-01-01T15:59:59.999999Z'),(2,'2026-01-01T16:00:00Z'),(3,'2026-01-02T15:59:59.999999Z'),(4,'2026-01-02T16:00:00Z')) as v(n,t)`.execute(db);
    const params = { keyword: 'ali', title: 'mat', author: 'lic', region: '北京', sourceName: '来源', category: '分类', status: 'crawled', startDate: '2026-01-02', endDate: '2026-01-02', orderBy: 'source_id', order: 'asc' as const };
    assert.equal(await countNewsForExport(params, db), 2);
    assert.deepEqual(sheet((await buildNewsWorkbook(params, ['source_id'], db)).buffer).rows.map(r => r['文章ID']), ['2','3']);
    assert.equal(await countNewsForExport({ ...params, endDate: '2026-01-01T16:00:00Z' }, db), 1);
    for (const mismatch of [{ keyword: 'no' }, { title: 'no' }, { author: 'no' }, { region: 'no' }, { sourceName: 'no' }, { category: 'no' }, { status: 'failed' }]) assert.equal(await countNewsForExport({ ...params, ...mismatch }, db), 0);
    assert.equal((await getNewsForExport({}, db, 1)).length, 1);
    assert.equal((await getNewsForExport({}, db)).length, 4);
    for (const bound of [0, -1, 1.5, Infinity]) await assert.rejects(() => getNewsForExport({}, db, bound), /limit/i);
  } finally { await db.destroy(); }
});

test('crawl workbooks preserve defaults, all/status semantics, calculated values and cancelled labels', async () => {
  const db = await fixture();
  try {
    await db.insertInto('crawl_sessions').values([
      { session_name: '取消任务', total_pages: 0, status: 'cancelled', total_news: 4, crawled_news: 3, started_at: '2026-01-01T16:00:00Z', finished_at: '2026-01-01T16:01:30Z' },
      { session_name: '完成任务', total_pages: 1, status: 'completed', started_at: '2026-01-01T15:00:00Z' },
    ]).execute();
    assert.equal(await countCrawlHistoryForExport({ status: 'all' }, db), 2);
    assert.equal(await countCrawlHistoryForExport({ status: 'cancelled' }, db), 1);
    const result = await buildCrawlHistoryWorkbook({ status: 'cancelled' }, undefined, db);
    assert.equal(result.rowCount, 1); assert.match(result.filename, /^crawl_history_\d{4}-\d{2}-\d{2}\.xlsx$/);
    const { wb, rows } = sheet(result.buffer); assert.deepEqual(wb.SheetNames, ['爬取历史']);
    assert.deepEqual(Object.keys(rows[0]), ['ID','任务名称','状态','开始时间']); assert.equal(rows[0]['状态'], '已取消'); assert.equal(rows[0]['开始时间'], new Date('2026-01-01T16:00:00Z').toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }));
    const custom = sheet((await buildCrawlHistoryWorkbook({ status: 'cancelled' }, ['total_pages','duration','success_rate','finished_at'], db)).buffer).rows[0];
    assert.equal(custom['总页数'], 0); assert.equal(custom['耗时(分钟)'], 1.5); assert.equal(custom['成功率'], '75%');
    const missing = sheet((await buildCrawlHistoryWorkbook({ status: 'completed' }, ['duration','success_rate','finished_at'], db)).buffer).rows[0]; assert.deepEqual(Object.values(missing), ['-','-','-']);
    assert.equal((await listExportHistory(1, 10, db)).total, 0);
  } finally { await db.destroy(); }
});

test('both builders count before materialization, reject empty/overflow, and allow exactly 20000', async () => {
  const db = await fixture(); const queries: RootOperationNode[] = [];
  const observed = db.withPlugin({ transformQuery(args: PluginTransformQueryArgs) { queries.push(args.node); return args.node; }, async transformResult(args: PluginTransformResultArgs) { return args.result; } });
  try {
    assert.equal(EXPORT_MAX_ROWS, 20000);
    for (const build of [buildNewsWorkbook, buildCrawlHistoryWorkbook]) await assert.rejects(() => build({}, undefined, observed), (e: unknown) => e instanceof ExportError && e.code === 'NO_DATA' && e.message === '没有可导出的数据');
    await sql`insert into news (source_id,title) select n::text, 'title' from generate_series(1,20001) n`.execute(db);
    await sql`insert into crawl_sessions (total_pages) select 1 from generate_series(1,20001)`.execute(db);
    for (const build of [buildNewsWorkbook, buildCrawlHistoryWorkbook]) {
      queries.length = 0;
      await assert.rejects(() => build({}, undefined, observed), (e: unknown) => e instanceof ExportError && e.code === 'TOO_MANY_ROWS' && e.message === overflow);
      assert.equal(queries.length, 1, 'overflow must execute count only');
    }
    await db.deleteFrom('news').where('source_id', '=', '20001').execute();
    await db.deleteFrom('crawl_sessions').where('id', '=', 20001).execute();
    for (const build of [buildNewsWorkbook, buildCrawlHistoryWorkbook]) {
      queries.length = 0;
      const result = await build({}, undefined, observed); assert.equal(result.rowCount, 20000);
      assert.equal(sheet(result.buffer).rows.length, 20000);
      assert.match(JSON.stringify(queries[0]), /count/);
      assert.ok('limit' in queries[1], 'materialization must have SQL LIMIT');
    }
  } finally { await db.destroy(); }
});

test('growth after count stays bounded and is rejected rather than silently truncated', async () => {
  const db = await fixture();
  try {
    for (const kind of ['news', 'crawl_sessions'] as const) {
      await sql.raw(kind === 'news' ? "insert into news (source_id,title) values ('initial','title')" : 'insert into crawl_sessions (total_pages) values (1)').execute(db);
      let counted = false;
      const racing = db.withPlugin({ transformQuery(args: PluginTransformQueryArgs) { return args.node; }, async transformResult(args: PluginTransformResultArgs) {
        if (!counted) {
          counted = true;
          await sql.raw(kind === 'news' ? "insert into news (source_id,title) select n::text,'title' from generate_series(1,20001) n" : 'insert into crawl_sessions (total_pages) select 1 from generate_series(1,20001)').execute(db);
        }
        return args.result;
      } });
      const build = kind === 'news' ? buildNewsWorkbook : buildCrawlHistoryWorkbook;
      await assert.rejects(() => build({}, undefined, racing), (e: unknown) => e instanceof ExportError && e.code === 'TOO_MANY_ROWS');
    }
  } finally { await db.destroy(); }
});
