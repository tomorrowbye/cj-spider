import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Kysely, PGliteDialect, sql } from 'kysely';
import { PGlite } from '@electric-sql/pglite';
import { migrate } from '../db/migrate';
import type { Database } from '../src/lib/db';
import { createCrawlController } from '../src/lib/crawl/task-manager';
import { saveCjSession, getCurrentCjSession } from '../src/lib/cj-session-repository';

const config = { startPage: 11, endPage: 13, skipExisting: true };
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
}
async function fixture() {
  const db = new Kysely<Database>({ dialect: new PGliteDialect({ pglite: new PGlite() }) });
  await migrate(db);
  return db;
}

test('migration reruns, singleton reservations, persisted login intent and ten minute idempotency', async () => {
  const db = await fixture();
  try {
    await migrate(db);
    const controller = createCrawlController({ db, getListPage: async () => { throw Error('no login must not fetch'); } });
    const [a, b] = await Promise.all([
      controller.start({ ...config, idempotencyKey: 'request' }), controller.start(config),
    ]);
    assert.equal(a.sessionId, b.sessionId);
    assert.equal(b.already_running, true);
    assert.equal(a.status, 'paused');
    assert.equal(a.pauseReason, 'cj_login_required');
    assert.equal(a.nextPage, 11);
    await controller.cancel(a.sessionId);
    assert.equal((await controller.start({ ...config, idempotencyKey: 'request' })).sessionId, a.sessionId);
    await db.updateTable('crawl_sessions').set({ started_at: new Date(Date.now() - 601_000) }).execute();
    assert.notEqual((await controller.start({ ...config, idempotencyKey: 'request' })).sessionId, a.sessionId);
  } finally { await db.destroy(); }
});

for (const state of ['completed', 'failed', 'cancelled'] as const) {
  test(`idempotency replay of ${state} task is not already running and never fetches again`, async () => {
    const db = await fixture(); let fetches = 0;
    const controller = createCrawlController({ db, getListPage: async () => { fetches++; throw Error('must not fetch'); } });
    try {
      const task = await controller.start({ ...config, idempotencyKey: 'ended-key' });
      const activeReplay = await controller.start({ ...config, idempotencyKey: 'ended-key' });
      assert.equal(activeReplay.already_running, true);
      await db.updateTable('crawl_sessions').set({ status: state, finished_at: new Date() }).where('id', '=', Number(task.sessionId)).execute();
      const replay = await controller.start({ ...config, idempotencyKey: 'ended-key' });
      assert.equal(replay.sessionId, task.sessionId);
      assert.equal(replay.status, state);
      assert.notEqual(replay.already_running, true);
      assert.equal(replay.idempotent_replay, true);
      await controller.waitForIdle();
      assert.equal(fetches, 0);
      assert.equal((await db.selectFrom('crawl_sessions').select('id').execute()).length, 1);
    } finally { await controller.waitForIdle(); await db.destroy(); }
  });
}

test('rejected login pauses at exact absolute cursor, invalidates only that login, resumes range', async () => {
  const db = await fixture();
  const entered = deferred(); const release = deferred();
  try {
    const old = await saveCjSession('old-cookie', new Date(Date.now() + 60_000), db);
    const pages: number[] = [];
    let reject = true;
    const controller = createCrawlController({ db, delay: async () => {}, getListPage: async page => {
      pages.push(page);
      if (page === 12 && reject) { entered.resolve(); await release.promise; return null; }
      return { page, total: 0, articles: [] };
    } });
    const task = await controller.start(config);
    await entered.promise;
    const fresh = await saveCjSession('new-cookie', new Date(Date.now() + 60_000), db);
    release.resolve(); await controller.waitForIdle();
    let status = (await controller.getStatus(task.sessionId))!;
    assert.equal(status.status, 'paused'); assert.equal(status.nextPage, 12); assert.equal(status.currentPage, 1);
    assert.equal((await getCurrentCjSession(db))?.id, fresh.id);
    assert.equal((await db.selectFrom('login_sessions').selectAll().where('id', '=', old.id).executeTakeFirstOrThrow()).is_valid, false);
    reject = false;
    assert.equal(await controller.resume(task.sessionId), true);
    await controller.waitForIdle();
    status = (await controller.getStatus(task.sessionId))!;
    assert.equal(status.status, 'completed'); assert.equal(status.currentPage, 3);
    assert.ok(status.finishedAt); assert.deepEqual(pages, [11, 12, 12, 13]);
    assert.doesNotMatch(JSON.stringify(status), /cookie/);
    assert.equal((await controller.start({ ...config, idempotencyKey: 'completed-key' })).status, 'running');
    await controller.waitForIdle();
    const completed = await controller.start({ ...config, idempotencyKey: 'completed-key' });
    assert.equal(completed.status, 'completed');
  } finally { release.resolve(); await db.destroy(); }
});

test('fast pause/resume drains old runner and cancellation cannot become completion', async () => {
  const db = await fixture(); const entered = deferred(); const release = deferred();
  try {
    await saveCjSession('cookie', new Date(Date.now() + 60_000), db);
    let calls = 0; let active = 0; let max = 0;
    const controller = createCrawlController({ db, delay: async () => {}, getListPage: async page => {
      calls++; active++; max = Math.max(max, active);
      if (calls === 1) { entered.resolve(); await release.promise; }
      active--; return { page, total: 0, articles: [] };
    } });
    const task = await controller.start(config); await entered.promise;
    assert.equal(await controller.pause(task.sessionId), true);
    assert.equal(await controller.resume(task.sessionId), true);
    assert.equal(calls, 1);
    assert.equal(await controller.cancel(task.sessionId), true);
    release.resolve(); await controller.waitForIdle();
    assert.equal((await controller.getStatus(task.sessionId))?.status, 'cancelled'); assert.equal(max, 1); assert.equal(calls, 1);
  } finally { release.resolve(); await db.destroy(); }
});

test('detail cancellation preserves fetched data and never completes cancelled execution', async () => {
  const db = await fixture(); const entered = deferred(); const release = deferred();
  const controller = createCrawlController({ db, delay: async () => {},
    getListPage: async page => ({ page, total: 0, articles: [] }),
    getArticleDetail: async id => {
      entered.resolve(); await release.promise;
      return { id, title: 'Fetched title', content: '<p>body</p>', contentText: 'body', source: '', author: '', topic: '', area: '', createdTime: '' };
    },
  });
  try {
    await saveCjSession('cookie', new Date(Date.now() + 60_000), db);
    await db.insertInto('news').values({ source_id: 'detail-1', title: 'pending', source_url: 'mock' }).execute();
    const task = await controller.start(config); await entered.promise;
    await controller.cancel(task.sessionId); release.resolve(); await controller.waitForIdle();
    assert.equal((await controller.getStatus(task.sessionId))?.status, 'cancelled');
    const article = await db.selectFrom('news').selectAll().executeTakeFirstOrThrow();
    assert.equal(article.status, 'crawled'); assert.equal(article.content_text, 'body');
  } finally { release.resolve(); await controller.waitForIdle(); await db.destroy(); }
});

test('global pending details persist counters and latest ten title events across controller instances', async () => {
  const db = await fixture();
  const controller = createCrawlController({ db, delay: async () => {},
    getListPage: async page => ({ page, total: 0, articles: [] }),
    getArticleDetail: async id => ({ id, title: `Title ${id}`, content: '', contentText: '', source: '', author: '', topic: '', area: '', createdTime: '' }),
  });
  try {
    await saveCjSession('cookie', new Date(Date.now() + 60_000), db);
    await db.insertInto('news').values(Array.from({ length: 12 }, (_, i) => ({ source_id: String(i), title: 'pending' }))).execute();
    const task = await controller.start(config); await controller.waitForIdle();
    const status = (await createCrawlController({ db }).getStatus(task.sessionId))!;
    assert.equal(status.status, 'completed'); assert.equal(status.crawledNews, 12);
    assert.equal(status.failedNews, 0); assert.equal(status.recentTitles.length, 10);
    for (const event of status.recentTitles) {
      assert.equal(event.status, 'crawled'); assert.equal(event.page, 13);
      assert.match(event.title, /^Title /); assert.ok(Number.isFinite(Date.parse(event.time)));
    }
  } finally { await controller.waitForIdle(); await db.destroy(); }
});

test('stale rejected list responses cannot invalidate the session after pause/resume', async () => {
  const db = await fixture(); const entered = deferred(); const release = deferred();
  let calls = 0;
  const controller = createCrawlController({ db, delay: async () => {}, getListPage: async page => {
    if (++calls === 1) { entered.resolve(); await release.promise; return null; }
    return { page, total: 0, articles: [] };
  } });
  try {
    const login = await saveCjSession('auth=fake', new Date(Date.now() + 60_000), db);
    const task = await controller.start(config); await entered.promise;
    await controller.pause(task.sessionId); await controller.resume(task.sessionId);
    release.resolve(); await controller.waitForIdle();
    assert.equal((await getCurrentCjSession(db))?.id, login.id);
    assert.equal((await controller.getStatus(task.sessionId))?.status, 'completed');
    assert.equal(calls, 4);
  } finally { release.resolve(); await controller.waitForIdle(); await db.destroy(); }
});

test('detail resume works without a login and retryFailed retains the baseline reset-only contract', async () => {
  const db = await fixture(); let listCalls = 0;
  const controller = createCrawlController({ db, delay: async () => {},
    getListPage: async () => { listCalls++; throw Error('must not fetch list'); },
    getArticleDetail: async id => ({ id, title: 'Retried', content: '', contentText: '', source: '', author: '', topic: '', area: '', createdTime: '' }),
  });
  try {
    await controller.recover();
    await db.insertInto('news').values({ source_id: 'retry', title: 'failed', status: 'failed' }).execute();
    assert.deepEqual(await controller.retryFailed(), { count: 1 });
    assert.equal(await controller.getCurrent(), null);
    const row = await db.insertInto('crawl_sessions').values({ status: 'paused', phase: 'detail', total_pages: 1, pending_news: 1 }).returning('id').executeTakeFirstOrThrow();
    assert.equal(await controller.resume(String(row.id)), true);
    await controller.waitForIdle();
    assert.equal((await controller.getStatus(String(row.id)))?.status, 'completed');
    assert.equal((await controller.getStatus(String(row.id)))?.crawledNews, 1);
    assert.equal(listCalls, 0);
  } finally { await controller.waitForIdle(); await db.destroy(); }
});

test('page insertion rolls back when advancing its persisted cursor fails', async () => {
  const db = await fixture();
  const controller = createCrawlController({ db, delay: async () => {},
    getListPage: async page => ({ page, total: 1, articles: [{ id: 'atomic-page', title: 'Atomic page', link: 'https://example.test/article', topic: '', createdTime: '', status: '' }] }),
  });
  try {
    await controller.recover();
    await saveCjSession('cookie', new Date(Date.now() + 60_000), db);
    await sql`CREATE FUNCTION reject_cursor() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.next_page > OLD.next_page THEN RAISE EXCEPTION 'cursor write failed'; END IF; RETURN NEW; END $$`.execute(db);
    await sql`CREATE TRIGGER reject_cursor BEFORE UPDATE ON crawl_sessions FOR EACH ROW EXECUTE FUNCTION reject_cursor()`.execute(db);
    const task = await controller.start({ ...config, endPage: 11 });
    await controller.waitForIdle();
    const persisted = await controller.getStatus(task.sessionId);
    assert.equal(persisted?.status, 'failed');
    assert.equal(persisted?.nextPage, 11);
    assert.equal(persisted?.totalNews, 0);
    assert.equal((await db.selectFrom('news').select('id').execute()).length, 0);
  } finally { await controller.waitForIdle(); await db.destroy(); }
});

test('a rejected detail worker drains siblings before another controller starts fetching', async () => {
  const db = await fixture(); const slowEntered = deferred(); const release = deferred(); const rejected = deferred();
  let detailCalls = 0; let listCalls = 0;
  const controller = createCrawlController({ db,
    delay: async ms => { if (ms === 200) { rejected.resolve(); throw Error('worker failed'); } },
    getListPage: async page => { listCalls++; return { page, total: 0, articles: [] }; },
    getArticleDetail: async id => {
      if (++detailCalls === 2) { slowEntered.resolve(); await release.promise; }
      return { id, title: 'Fetched', content: '', contentText: '', source: '', author: '', topic: '', area: '', createdTime: '' };
    },
  });
  const other = createCrawlController({ db, delay: async () => {},
    getListPage: async page => { listCalls++; return { page, total: 0, articles: [] }; },
  });
  try {
    await controller.recover();
    await saveCjSession('cookie', new Date(Date.now() + 60_000), db);
    await db.insertInto('news').values([{ source_id: 'first', title: 'pending' }, { source_id: 'second', title: 'pending' }]).execute();
    const row = await db.insertInto('crawl_sessions').values({ status: 'paused', phase: 'detail', total_pages: 1 }).returning('id').executeTakeFirstOrThrow();
    await controller.resume(String(row.id)); await slowEntered.promise; await rejected.promise;
    await controller.cancel(String(row.id));
    const next = await other.start(config);
    // Flush asynchronous DB/queue work while the sibling's upstream request remains blocked.
    for (let i = 0; i < 10; i++) await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(listCalls, 0);
    release.resolve(); await other.waitForIdle();
    assert.equal((await controller.getStatus(String(row.id)))?.status, 'cancelled');
    assert.equal((await other.getStatus(next.sessionId))?.status, 'completed');
    assert.equal(listCalls, 3);
  } finally { release.resolve(); await controller.waitForIdle(); await db.destroy(); }
});

test('first access recovers legacy running rows once and does not clear a new runner', async () => {
  const db = await fixture();
  try {
    const old = await db.insertInto('crawl_sessions').values({ total_pages: 7, current_page: 2 }).returning('id').executeTakeFirstOrThrow();
    const controller = createCrawlController({ db });
    const recovered = (await controller.getStatus(String(old.id)))!;
    assert.equal(recovered.status, 'paused'); assert.equal(recovered.pauseReason, 'server_restart');
    assert.equal(recovered.nextPage, 3); assert.equal(recovered.endPage, 7);
    await controller.cancel(recovered.sessionId);
    const task = await controller.start(config);
    const other = createCrawlController({ db });
    assert.equal((await other.getStatus(task.sessionId))?.pauseReason, 'cj_login_required');
  } finally { await db.destroy(); }
});
