import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Kysely, PGliteDialect, sql } from 'kysely';
import { PGlite } from '@electric-sql/pglite';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { migrate } from '../db/migrate';
import type { Database } from '../src/lib/db';
import { createApiKey } from '../src/lib/api-keys';
import { createMcpHandler } from '../src/lib/mcp/handler';
import { createRateLimiter, redactArgs } from '../src/lib/mcp/security';
import { DEFAULT_NEWS_COLUMNS, DEFAULT_CRAWL_HISTORY_COLUMNS, NEWS_COLUMN_DEFINITIONS, CRAWL_HISTORY_COLUMN_DEFINITIONS } from '../src/lib/export-service';

const instant = Date.parse('2026-01-02T00:00:00Z');
function output(value: Awaited<ReturnType<Client['callTool']>>) { return value.structuredContent as Record<string, unknown>; }
async function fixture() {
  const db = new Kysely<Database>({ dialect: new PGliteDialect({ pglite: new PGlite() }) });
  await migrate(db);
  const user = await db.insertInto('site_users').values({ username: 'export-member', password_hash: 'unused', role: 'user' }).returningAll().executeTakeFirstOrThrow();
  const key = await createApiKey({ userId: user.id, name: 'export' }, db);
  let now = instant;
  const logs: string[] = [];
  const queries: string[] = [];
  const observed = db.withPlugin({ transformQuery(args) { queries.push(JSON.stringify(args.node)); return args.node; }, async transformResult(args) { return args.result; } });
  const handler = createMcpHandler({ db: observed, clock: () => now, log: line => logs.push(line), publicBaseUrl: 'https://exports.test' });
  async function connect(token = key.key) {
    const client = new Client({ name: 'export-test', version: '1' });
    await client.connect(new StreamableHTTPClientTransport(new URL('http://mcp.test/api/mcp'), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } }, fetch: (input, init) => handler(new Request(input, init)),
    }));
    return client;
  }
  const client = await connect();
  return { db, user, key, logs, queries, client, connect, advance: (ms = 60_000) => { now += ms; }, close: async () => { await client.close(); await db.destroy(); } };
}

test('SDK export links count only, defaults/custom columns, member access, global history and private audits', async () => {
  const f = await fixture(); const { db, client } = f;
  try {
    await db.insertInto('news').values({ source_id: '1', title: 'hello', author: 'Alice', region: '上海', source_name: 'source', publish_time: new Date('2026-01-01T16:00:00Z'), content_text: 'body' }).execute();
    await db.insertInto('crawl_sessions').values({ total_pages: 1, status: 'completed' }).execute();
    const tools = (await client.listTools()).tools;
    assert.deepEqual(tools.slice(-3).map(t => t.name), ['export_news', 'export_crawl_history', 'list_export_history']);
    assert.equal(tools.length, 12);
    for (const tool of tools.slice(-3, -1)) {
      assert.match(tool.description!, /30.*分钟/); assert.match(tool.description!, /3.*次/); assert.match(tool.description!, /用户/); assert.match(tool.description!, /自行下载/);
      assert.equal(tool.inputSchema.additionalProperties, false);
    }
    f.queries.length = 0;
    const news = output(await client.callTool({ name: 'export_news', arguments: {} }));
    assert.equal(news.row_count, 1); assert.deepEqual(news.columns, DEFAULT_NEWS_COLUMNS);
    assert.equal(news.expires_at, '2026-01-02T08:30:00+08:00'); assert.equal(news.max_downloads, 3);
    assert.match(news.download_url as string, /^https:\/\/exports.test\/api\/exports\/download\/[A-Za-z0-9_-]{43}$/);
    assert.match(news.file_name as string, /\.xlsx$/);
    const selects = f.queries.filter(q => q.includes('"kind":"SelectQueryNode"') && q.includes('"name":"news"'));
    assert.ok(selects.length > 0); assert.ok(selects.every(q => q.includes('"func":"count"')));
    const args = { keyword: 'hello', author: 'Alice', region: '上海', source_name: 'source', start_date: '2026-01-02', end_date: '2026-01-02', columns: ['title', 'title', 'content_text'], include_content: true };
    const custom = output(await client.callTool({ name: 'export_news', arguments: args }));
    assert.deepEqual(custom.columns, ['title', 'content_text']); assert.equal(custom.row_count, 1);
    const content = output(await client.callTool({ name: 'export_news', arguments: { include_content: true } }));
    assert.deepEqual(content.columns, [...DEFAULT_NEWS_COLUMNS, 'content_text']);
    const crawl = output(await client.callTool({ name: 'export_crawl_history', arguments: { status: 'completed' } }));
    assert.equal(crawl.row_count, 1); assert.deepEqual(crawl.columns, DEFAULT_CRAWL_HISTORY_COLUMNS);
    const customCrawl = output(await client.callTool({ name: 'export_crawl_history', arguments: { columns: ['status', 'id', 'status'] } }));
    assert.deepEqual(customCrawl.columns, ['status', 'id']);
    assert.equal((await db.selectFrom('export_history').selectAll().execute()).length, 3);
    const links = await db.selectFrom('export_links').selectAll().execute(); assert.equal(links.length, 5);
    assert.ok(links.every(l => l.user_id === f.user.id && l.api_key_id === f.key.id));
    assert.deepEqual((links[1].params as { filters: unknown }).filters, { keyword: 'hello', author: 'Alice', region: '上海', sourceName: 'source', startDate: '2026-01-02', endDate: '2026-01-02' });
    await db.insertInto('export_history').values({ file_name: 'web-export.xlsx', total_count: 2, columns: ['title'], keyword: 'web-global', created_at: new Date('2099-01-01Z') }).execute();
    const history = output(await client.callTool({ name: 'list_export_history', arguments: { limit: 1 } }));
    const rows = history.data as Record<string, unknown>[]; assert.equal(rows.length, 1); assert.equal(history.total, 4);
    assert.deepEqual(Object.keys(rows[0]).sort(), ['id','file_name','keyword','author','region','source_name','start_date','end_date','total_count','columns','created_at'].sort());
    assert.equal(rows[0].keyword, 'web-global'); assert.equal(rows[0].total_count, 2); assert.match(rows[0].created_at as string, /\+08:00$/);
    assert.equal((await client.callTool({ name: 'create_user', arguments: { username: 'blocked' } })).isError, true);
    const audits = await db.selectFrom('mcp_audit_log').selectAll().execute();
    assert.deepEqual(audits.find(a => a.tool === 'export_news' && (a.args_redacted as Record<string, unknown>).keyword)?.args_redacted, { ...args, columns: ['title','content_text'] });
    assert.deepEqual(audits.find(a => a.tool === 'list_export_history')?.args_redacted, { limit: 1 });
    const privateText = JSON.stringify(audits) + f.logs.join('');
    assert.ok(!privateText.includes(f.key.key));
    for (const url of [news.download_url, custom.download_url, content.download_url, crawl.download_url, customCrawl.download_url] as string[]) {
      assert.ok(!privateText.includes(url)); assert.ok(!privateText.includes(url.split('/').at(-1)!));
    }
    await db.updateTable('site_users').set({ is_active: false }).where('id', '=', f.user.id).execute();
    await assert.rejects(client.callTool({ name: 'export_news', arguments: {} }));
  } finally { await f.close(); }
});

test('SDK strict export validation rejects unsafe inputs before persistence and accepts all defined columns', async () => {
  const f = await fixture();
  try {
    await f.db.insertInto('news').values({ source_id: '1', title: 'hello' }).execute();
    await f.db.insertInto('crawl_sessions').values({ total_pages: 1 }).execute();
    const badNews = [{ keyword: 'x'.repeat(201) }, { author: 'x'.repeat(201) }, { region: 4 }, { source_name: 'x'.repeat(201) }, { start_date: '2026-02-30' }, { start_date: '2025-02-29' }, { start_date: '2026-1-01' }, { end_date: '2026-01-01T00:00:00Z' }, { start_date: '2026-02-01', end_date: '2026-01-01' }, { columns: [] }, { columns: ['toString'] }, { columns: ['id'] }, { include_content: 'true' }, { token: 'secret-token' }, { limit: 1 }];
    for (const args of badNews) {
      f.advance();
      const r = await f.client.callTool({ name: 'export_news', arguments: args });
      assert.equal(r.isError, true); assert.match(output(r).error as string, /参数无效/);
    }
    for (const args of [{ status: 'all' }, { status: 'pending' }, { columns: [] }, { columns: ['title'] }, { keyword: 'hello' }]) {
      f.advance(); const r = await f.client.callTool({ name: 'export_crawl_history', arguments: args });
      assert.equal(r.isError, true); assert.match(output(r).error as string, /参数无效/);
    }
    for (const args of [{ limit: 0 }, { limit: 51 }, { limit: 1.5 }, { limit: '1' }, { page: 1 }]) {
      const r = await f.client.callTool({ name: 'list_export_history', arguments: args }); assert.equal(r.isError, true); assert.match(output(r).error as string, /参数无效/);
    }
    assert.equal((await f.db.selectFrom('export_links').selectAll().execute()).length, 0);
    assert.equal((await f.db.selectFrom('export_history').selectAll().execute()).length, 0);
    f.advance();
    assert.deepEqual(output(await f.client.callTool({ name: 'export_news', arguments: { columns: Object.keys(NEWS_COLUMN_DEFINITIONS) } })).columns, Object.keys(NEWS_COLUMN_DEFINITIONS));
    assert.deepEqual(output(await f.client.callTool({ name: 'export_crawl_history', arguments: { columns: Object.keys(CRAWL_HISTORY_COLUMN_DEFINITIONS) } })).columns, Object.keys(CRAWL_HISTORY_COLUMN_DEFINITIONS));
    assert.deepEqual(output(await f.client.callTool({ name: 'list_export_history', arguments: {} })).data instanceof Array, true);
    const audits = JSON.stringify(await f.db.selectFrom('mcp_audit_log').selectAll().execute());
    assert.ok(!audits.includes('secret-token')); assert.ok(!audits.includes('x'.repeat(201))); assert.ok(!audits.includes('2026-02-30'));
  } finally { await f.close(); }
});

test('SDK date-only filters cover Beijing final microsecond and exclude next midnight', async () => {
  const f = await fixture();
  try {
    await sql`insert into news (source_id,title,publish_time) values ('1','before','2026-01-01T15:59:59.999999Z'),('2','start','2026-01-01T16:00:00Z'),('3','last','2026-01-02T15:59:59.999999Z'),('4','next','2026-01-02T16:00:00Z')`.execute(f.db);
    const r = await f.client.callTool({ name: 'export_news', arguments: { start_date: '2026-01-02', end_date: '2026-01-02' } });
    assert.equal(r.isError, undefined); assert.equal(output(r).row_count, 2);
  } finally { await f.close(); }
});

test('SDK maps no-data and overflow to explicit private errors for both export kinds', async () => {
  const f = await fixture();
  try {
    for (const name of ['export_news', 'export_crawl_history']) {
      const r = await f.client.callTool({ name, arguments: {} }); assert.equal(r.isError, true); assert.equal(output(r).error, '没有可导出的数据');
    }
    await sql`insert into news (source_id,title) select n::text,'hello' from generate_series(1,20001) n`.execute(f.db);
    await sql`insert into crawl_sessions (total_pages) select 1 from generate_series(1,20001)`.execute(f.db);
    for (const name of ['export_news', 'export_crawl_history']) {
      const r = await f.client.callTool({ name, arguments: {} }); assert.equal(r.isError, true); assert.equal(output(r).error, '导出数据超过 20000 条，请缩小日期范围或增加筛选条件');
    }
    assert.equal((await f.db.selectFrom('export_links').selectAll().execute()).length, 0);
    await f.db.schema.dropTable('export_history').execute();
    const failed = await f.client.callTool({ name: 'list_export_history', arguments: {} });
    assert.equal(failed.isError, true); assert.match(output(failed).error as string, /工具执行失败/); assert.doesNotMatch(JSON.stringify(failed) + f.logs.join(''), /does not exist|relation|select \*/);
  } finally { await f.close(); }
});

test('SDK export bucket is shared by both tools, isolated per key and refills after 12 seconds', async () => {
  const f = await fixture();
  try {
    await f.db.insertInto('news').values({ source_id: '1', title: 'hello' }).execute();
    await f.db.insertInto('crawl_sessions').values({ total_pages: 1 }).execute();
    for (let i = 0; i < 5; i++) assert.equal((await f.client.callTool({ name: i % 2 ? 'export_news' : 'export_crawl_history', arguments: {} })).isError, undefined);
    assert.match(output(await f.client.callTool({ name: 'export_news', arguments: {} })).error as string, /频繁/);
    assert.equal((await f.client.callTool({ name: 'list_export_history', arguments: {} })).isError, undefined);
    const key2 = await createApiKey({ userId: f.user.id, name: 'isolated' }, f.db); const other = await f.connect(key2.key);
    try { assert.equal((await other.callTool({ name: 'export_news', arguments: {} })).isError, undefined); } finally { await other.close(); }
    f.advance(11_999); assert.match(output(await f.client.callTool({ name: 'export_crawl_history', arguments: {} })).error as string, /频繁/);
    f.advance(1); assert.equal((await f.client.callTool({ name: 'export_news', arguments: {} })).isError, undefined);
    assert.equal((await f.db.selectFrom('export_links').selectAll().execute()).length, 7);
  } finally { await f.close(); }
});

test('export rate bucket preserves global 60 calls and validates audit metadata independently', () => {
  const take = createRateLimiter(() => 0);
  for (let i = 0; i < 59; i++) assert.equal(take('list_export_history'), true);
  assert.equal(take('export_news'), true); assert.equal(take('export_crawl_history'), false);
  assert.deepEqual(redactArgs('export_news', { keyword: 'valid', columns: ['title','title'], include_content: true }), { keyword: 'valid', columns: ['title'], include_content: true });
  assert.deepEqual(redactArgs('export_news', { keyword: 'x'.repeat(201), start_date: '2026-02-30', download_url: 'https://secret.test/token' }), {});
  assert.deepEqual(redactArgs('export_crawl_history', { status: 'oops', columns: ['toString'] }), {});
  assert.deepEqual(redactArgs('list_export_history', {}), { limit: 10 });
});
