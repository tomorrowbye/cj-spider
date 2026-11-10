import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { Kysely, PGliteDialect, sql } from 'kysely';
import { PGlite } from '@electric-sql/pglite';
import * as XLSX from 'xlsx';
import { migrate } from '../db/migrate';
import type { Database } from '../src/lib/db';

const instant = new Date('2026-01-02T00:00:00Z');
async function fixture() {
  const db = new Kysely<Database>({ dialect: new PGliteDialect({ pglite: new PGlite() }) });
  await migrate(db);
  const user = await db.insertInto('site_users').values({ username: 'links', password_hash: 'not-used' }).returning('id').executeTakeFirstOrThrow();
  const options = { db, now: () => instant };
  return { db, userId: Number(user.id), options };
}
async function service() {
  const mod = await import('../src/lib/export-links').catch(() => null);
  assert.ok(mod, 'persisted export link service must exist');
  return mod;
}
function token(url: string) { return new URL(url).pathname.split('/').at(-1)!; }
function privacy(response: Response) {
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
}

test('migration is idempotent and creates constrained export links with cascading ownership', async () => {
  const { db, userId } = await fixture();
  try {
    await migrate(db);
    const tables = await db.introspection.getTables();
    assert.ok(tables.some(t => t.name === 'export_links'), '003 must create export_links');
    const { up } = await import('../db/migrations/003-export-links');
    await up(db as unknown as Kysely<unknown>); await up(db as unknown as Kysely<unknown>);
    const apiKey = await db.insertInto('api_keys').values({ user_id: userId, name: 'test', key_prefix: 'prefix', key_hash: 'hash' }).returning('id').executeTakeFirstOrThrow();
    const { createExportLink } = await service();
    await db.insertInto('news').values({ source_id: '1', title: 'hello' }).execute();
    await createExportLink({ kind: 'news', params: {}, userId, apiKeyId: Number(apiKey.id) }, { db, now: () => instant });
    await db.deleteFrom('api_keys').where('id', '=', Number(apiKey.id)).execute();
    assert.equal((await db.selectFrom('export_links').selectAll().executeTakeFirstOrThrow()).api_key_id, null);
    await assert.rejects(() => sql`update export_links set kind = 'bad'`.execute(db));
    await assert.rejects(() => sql`update export_links set download_count = -1`.execute(db));
    await db.deleteFrom('site_users').where('id', '=', userId).execute();
    assert.equal((await db.selectFrom('export_links').selectAll().execute()).length, 0);
  } finally { await db.destroy(); }
});

test('creation persists only hash and validated params, counts without fetching, and records news history exactly once', async () => {
  const { db, userId, options } = await fixture();
  try {
    const { createExportLink, downloadExport } = await service();
    await db.insertInto('news').values([{ source_id: '1', title: 'hello', author: 'Alice' }, { source_id: '2', title: 'excluded', author: 'Bob' }]).execute();
    const queries: string[] = [];
    const observed = db.withPlugin({ transformQuery(args) { queries.push(JSON.stringify(args.node)); return args.node; }, async transformResult(args) { return args.result; } });
    const result = await createExportLink({ kind: 'news', params: { author: 'Alice' }, columns: ['author', 'title'], userId }, { ...options, db: observed });
    assert.equal(result.row_count, 1); assert.equal(result.max_downloads, 3); assert.deepEqual(result.columns, ['author', 'title']);
    assert.equal(result.expires_at, '2026-01-02T08:30:00+08:00');
    assert.match(result.download_url, /^https:\/\/spider\.wakaja\.top\/api\/exports\/download\/[A-Za-z0-9_-]{43}$/);
    assert.ok(queries.filter(q => q.includes('"kind":"SelectQueryNode"') && q.includes('"name":"news"')).every(q => q.includes('"func":"count"')), 'creation must only count news, not fetch workbook rows');
    const raw = token(result.download_url);
    const stored = await db.selectFrom('export_links').selectAll().executeTakeFirstOrThrow();
    assert.equal(stored.token_hash, createHash('sha256').update(raw).digest('hex'));
    assert.equal(stored.token_prefix, raw.slice(0, 8));
    assert.ok(!JSON.stringify(stored).includes(raw));
    assert.deepEqual(stored.params, { filters: { author: 'Alice' }, columns: ['author', 'title'] });
    assert.equal((await db.selectFrom('export_history').selectAll().execute()).length, 1);
    const response = await downloadExport(raw, options); privacy(response); assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    assert.equal(response.headers.get('content-disposition'), `attachment; filename*=UTF-8''${encodeURIComponent(result.file_name)}`);
    const wb = XLSX.read(Buffer.from(await response.arrayBuffer()), { type: 'buffer' });
    assert.deepEqual(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]), [{ '作者': 'Alice', '标题': 'hello' }]);
    assert.equal((await db.selectFrom('export_history').selectAll().execute()).length, 1);
  } finally { await db.destroy(); }
});

test('empty and over-limit exports are rejected; exactly 20000 creates a link without a workbook', async () => {
  const { db, userId, options } = await fixture();
  try {
    const { createExportLink } = await service();
    for (const kind of ['news', 'crawl_history'] as const) await assert.rejects(() => createExportLink({ kind, params: {}, userId }, options), /没有可导出的数据/);
    await sql`insert into news (source_id,title) select n::text, 'title' from generate_series(1,20001) n`.execute(db);
    await sql`insert into crawl_sessions (total_pages) select 1 from generate_series(1,20001)`.execute(db);
    for (const kind of ['news', 'crawl_history'] as const) await assert.rejects(() => createExportLink({ kind, params: {}, userId }, options), /20000/);
    assert.equal((await db.selectFrom('export_links').selectAll().execute()).length, 0);
    await db.deleteFrom('news').where('source_id', '=', '20001').execute();
    await db.deleteFrom('crawl_sessions').where('id', '=', 20001).execute();
    for (const kind of ['news', 'crawl_history'] as const) assert.equal((await createExportLink({ kind, params: {}, userId }, options)).row_count, 20000);
  } finally { await db.destroy(); }
});

test('invalid requests and unsafe base URLs fail before persistence', async () => {
  const { db, userId, options } = await fixture();
  try {
    const { createExportLink } = await service();
    await db.insertInto('news').values({ source_id: '1', title: 'hello' }).execute();
    for (const params of [{ page: 1 }, { status: 'oops' }, { orderBy: 'raw SQL' }, { startDate: '2026-02-30' }, { startDate: '2026-03-01', endDate: '2026-02-01' }]) {
      await assert.rejects(() => createExportLink({ kind: 'news', params, userId }, options));
    }
    for (const columns of [[], ['wat'], ['title', 'title']]) await assert.rejects(() => createExportLink({ kind: 'news', params: {}, columns, userId }, options));
    for (const publicBaseUrl of ['ftp://example.com', 'https://u:p@example.com', 'https://example.com?q=1', 'https://example.com/#x', 'not a URL']) await assert.rejects(() => createExportLink({ kind: 'news', params: {}, userId }, { ...options, publicBaseUrl }));
    assert.equal((await db.selectFrom('export_links').selectAll().execute()).length, 0);
    const link = await createExportLink({ kind: 'news', params: {}, userId }, { ...options, publicBaseUrl: 'http://localhost:3000/' });
    assert.ok(link.download_url.startsWith('http://localhost:3000/api/exports/download/'));
  } finally { await db.destroy(); }
});

test('all invalid tokens, expired links, and inactive accounts produce the same private 404', async () => {
  const { db, userId, options } = await fixture();
  try {
    const { createExportLink, downloadExport } = await service();
    await db.insertInto('news').values({ source_id: '1', title: 'hello' }).execute();
    const raw = token((await createExportLink({ kind: 'news', params: {}, userId }, options)).download_url);
    const cases = [await downloadExport('', options), await downloadExport('bad', options), await downloadExport('A'.repeat(43), options), await downloadExport(raw, { ...options, now: () => new Date('2026-01-02T00:30:00Z') })];
    await db.updateTable('site_users').set({ is_active: false }).where('id', '=', userId).execute();
    cases.push(await downloadExport(raw, options));
    for (const response of cases) { privacy(response); assert.equal(response.status, 404); assert.equal(await response.text(), 'Not Found'); }
    assert.equal((await db.selectFrom('export_links').select('download_count').executeTakeFirstOrThrow()).download_count, 0);
  } finally { await db.destroy(); }
});

test('atomic claim allows only three sequential or concurrent downloads; crawl creates no news history', async () => {
  const { db, userId, options } = await fixture();
  try {
    const { createExportLink, downloadExport } = await service();
    await db.insertInto('crawl_sessions').values({ total_pages: 1, session_name: 'Task', status: 'completed' }).execute();
    for (const concurrent of [false, true]) {
      const link = await createExportLink({ kind: 'crawl_history', params: { status: 'completed' }, columns: ['session_name'], userId }, options);
      const raw = token(link.download_url);
      const responses: Response[] = [];
      if (concurrent) responses.push(...await Promise.all(Array.from({ length: 8 }, () => downloadExport(raw, options))));
      else for (let i = 0; i < 4; i++) responses.push(await downloadExport(raw, options));
      assert.equal(responses.filter(r => r.status === 200).length, 3);
      assert.ok(responses.filter(r => r.status !== 200).every(r => r.status === 404));
      responses.forEach(privacy);
      const wb = XLSX.read(Buffer.from(await responses.find(r => r.status === 200)!.arrayBuffer()), { type: 'buffer' });
      assert.deepEqual(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]), [{ '任务名称': 'Task' }]);
    }
    assert.equal((await db.selectFrom('export_history').selectAll().execute()).length, 0);
    assert.deepEqual((await db.selectFrom('export_links').select('download_count').execute()).map(r => r.download_count), [3, 3]);
  } finally { await db.destroy(); }
});

test('creation cleans only links expired more than 24h and history rolls back if insertion fails', async () => {
  const { db, userId, options } = await fixture();
  try {
    const { createExportLink } = await service();
    await db.insertInto('news').values({ source_id: '1', title: 'hello' }).execute();
    const input = { kind: 'news' as const, params: {}, userId };
    await createExportLink(input, options);
    await db.updateTable('export_links').set({ expires_at: '2025-12-31T23:59:59Z' }).execute();
    await createExportLink(input, options);
    assert.equal((await db.selectFrom('export_links').selectAll().execute()).length, 1);
    await db.updateTable('export_links').set({ expires_at: '2026-01-01T00:00:00Z' }).execute();
    await createExportLink(input, options);
    assert.equal((await db.selectFrom('export_links').selectAll().execute()).length, 2);
    const before = (await db.selectFrom('export_history').selectAll().execute()).length;
    await assert.rejects(() => createExportLink({ ...input, apiKeyId: 99999 }, options));
    assert.equal((await db.selectFrom('export_history').selectAll().execute()).length, before);
  } finally { await db.destroy(); }
});

test('public GET route requires no authentication and keeps failures private', async () => {
  const { db, userId, options } = await fixture();
  try {
    const { createExportLink, createDownloadHandler } = await service();
    const { GET } = await import('../src/app/api/exports/download/[token]/route');
    assert.equal(typeof GET, 'function');
    await db.insertInto('news').values({ source_id: '1', title: 'hello' }).execute();
    const raw = token((await createExportLink({ kind: 'news', params: {}, userId }, options)).download_url);
    const handler = createDownloadHandler(options);
    const ok = await handler(new Request('http://localhost/download'), { params: Promise.resolve({ token: raw }) });
    assert.equal(ok.status, 200); privacy(ok);
    const bad = await handler(new Request('http://localhost/download'), { params: Promise.resolve({ token: 'bad' }) });
    assert.equal(bad.status, 404); privacy(bad);
  } finally { await db.destroy(); }
});
