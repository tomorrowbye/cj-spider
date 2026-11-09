import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

test('PostgreSQL migration and repository preserve full articles, filtering, history and progress', async () => {
  assert.ok(existsSync('src/lib/db.ts'), 'PostgreSQL data layer must exist');
  const { PGlite } = await import('@electric-sql/pglite');
  const { Kysely, PGliteDialect } = await import('kysely');
  const { migrate } = await import('../../../db/migrate');
  const repo = await import('../article-repository');
  const news = await import('../news-service');
  const stats = await import('../stats-service');
  const pg = new PGlite();
  const db = new Kysely<import('../db').Database>({ dialect: new PGliteDialect({pglite: pg}) });
  try {
    await migrate(db);
    await migrate(db);
    const tables = await db.introspection.getTables();
    for (const name of ['news', 'crawl_sessions', 'site_users', 'auth_identities', 'export_history', 'crawl_tasks', 'login_sessions']) assert.ok(tables.some(t => t.name === name), name);
    const item = { id: '100', title: '黄山 news', link: 'https://example.test/100', topic: '新闻', createdTime: '2026-04-10 21:46:24', status: '通过' };
    assert.equal(await repo.insertArticles([item, {...item, id: '101', title: 'Other'}], db), 2);
    assert.equal(await repo.insertArticles([item], db), 0);
    assert.equal(await repo.insertArticles([], db), 0);
    assert.equal(await repo.getPendingArticlesCount(db), 2);
    assert.deepEqual(await repo.getExistingArticleIds([], db), new Set());
    assert.deepEqual(await repo.getExistingArticleIds(['100', '999'], db), new Set(['100']));
    await repo.updateArticleDetail({ id: '100', title: item.title, content: '<p>正文</p>', contentText: '正文', author: 'Tom', source: '星报', topic: '新闻', area: '黄山', createdTime: item.createdTime, rawHtml: '<html/>' }, db);
    await db.updateTable('news').set({ tags: ['tag'], images: JSON.stringify([{url:'image'}]), summary: 'summary', contact_info: JSON.stringify({phone:'123'}) }).where('source_id', '=', '100').execute();
    const detail = await repo.getArticle('100', db);
    assert.equal(detail?.content, '<p>正文</p>');
    assert.equal(detail?.publish_time, '2026-04-10T13:46:24.000Z');
    assert.deepEqual(detail?.tags, ['tag']);
    assert.deepEqual(detail?.contact_info, {phone:'123'});
    const result = await news.getNewsList({author:'to', region:'黄山', title:'NEWS', startDate:'2026-04-10', endDate:'2026-04-10T23:59:59+08:00', pageSize:1}, db);
    assert.equal(result.total, 1);
    assert.equal(result.data[0].source_id, '100');
    assert.equal((await news.getNewsForExport({keyword:'Tom'}, db))[0].content_text, '正文');
    assert.deepEqual((await news.getFilterOptions(db)).authors, ['Tom']);
    await repo.markArticleFailed('101', 'failed', db);
    assert.deepEqual(await repo.getNewsStats(db), {total:2,pending:0,crawled:1,failed:1});
    assert.equal(await repo.resetFailedArticles(db), 1);
    const session = await repo.createCrawlSession({sessionName:'crawl', totalPages:2}, db);
    await repo.updateCrawlSession(session, {currentPage:1, pendingNews:1, failedNews:1, avgSpeed:2.5, phase:'detail', status:'paused'}, db);
    assert.equal((await repo.getCrawlSession(session, db))?.avg_speed, 2.5);
    assert.equal((await repo.getLatestCrawlSession(db))?.id, Number(session));
    assert.equal((await repo.getCrawlHistory({page:1,pageSize:10,status:'paused'}, db)).total, 1);
    await repo.updateCrawlSession(session, {status:'completed'}, db);
    assert.ok((await repo.getCrawlSession(session, db))?.finished_at);
    await repo.recordExport({file_name:'test.xlsx', total_count:1, columns:['title'], keyword:null}, db);
    const history = await repo.getExportHistory(1,10,db);
    assert.equal(history.total,1);
    await repo.deleteExportHistory(String(history.data[0].id),db);
    assert.equal((await repo.getExportHistory(1,10,db)).total,0);
    assert.equal((await stats.getOverview(db)).total,2);
    assert.deepEqual((await stats.getDistribution(db)).regions, [{name:'黄山',count:1}]);
    assert.equal((await stats.getContentStats(db)).withImages,1);
    assert.deepEqual((await stats.getContentStats(db)).topTags,[{tag:'tag',count:1}]);
    assert.equal((await stats.getTrend(7,db)).crawlTrend.length,7);
    const user = await db.insertInto('site_users').values({username:'test',password_hash:'hash'}).returning('id').executeTakeFirstOrThrow();
    await db.insertInto('auth_identities').values({user_id:user.id,provider:'wechat',provider_subject:'subject'}).execute();
    await assert.rejects(db.insertInto('auth_identities').values({user_id:user.id,provider:'wechat',provider_subject:'subject'}).execute());
  } finally { await db.destroy(); }
});

test('date-only news ranges include the whole +08 day for lists and exports', async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const { Kysely, PGliteDialect, sql } = await import('kysely');
  const { migrate } = await import('../../../db/migrate');
  const news = await import('../news-service');
  const db = new Kysely<import('../db').Database>({ dialect: new PGliteDialect({pglite: new PGlite()}) });
  try {
    await migrate(db);
    const fixtures = [
      ['previous', '2026-04-09T23:59:59.999+08:00'],
      ['start', '2026-04-10T00:00:00+08:00'],
      ['midday', '2026-04-10T12:00:00+08:00'],
      ['final-ms', '2026-04-10T23:59:59.999+08:00'],
      ['final-microsecond', '2026-04-10T23:59:59.999999+08:00'],
      ['next-midnight', '2026-04-11T00:00:00+08:00'],
    ];
    for (const [source_id, timestamp] of fixtures) {
      await db.insertInto('news').values({source_id, title:source_id, publish_time:sql<Date>`${timestamp}::timestamptz`}).execute();
    }
    const params = {startDate:'2026-04-10', endDate:'2026-04-10', orderBy:'publish_time', order:'asc' as const};
    const expected = ['start', 'midday', 'final-ms', 'final-microsecond'];
    const result = await news.getNewsList(params, db);
    assert.equal(result.total, expected.length);
    assert.deepEqual(result.data.map(row => row.source_id), expected);
    assert.deepEqual((await news.getNewsForExport(params, db)).map(row => row.source_id), expected);
    const explicitEnd = {...params, endDate:'2026-04-10T12:00:00+08:00'};
    assert.deepEqual((await news.getNewsList(explicitEnd, db)).data.map(row => row.source_id), ['start', 'midday']);
    assert.deepEqual((await news.getNewsForExport(explicitEnd, db)).map(row => row.source_id), ['start', 'midday']);
  } finally { await db.destroy(); }
});

test('data module imports do not require a runtime DATABASE_URL', async () => {
  delete process.env.DATABASE_URL;
  assert.ok(existsSync('src/lib/db.ts'), 'lazy PostgreSQL module must exist');
  const {getDb} = await import('../db');
  assert.throws(() => getDb(), /DATABASE_URL/);
});
