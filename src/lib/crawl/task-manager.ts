import 'server-only';
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { CRAWL_CONFIG } from './config';
import { getListPage, filterValidArticles } from './list-parser';
import { getArticleDetail } from './detail-parser';
import type { CrawlTaskConfig, CrawlProgress, RecentTitle } from './types';
import { getDb } from '../db';
import { insertArticles, updateArticleDetail, markArticleFailed, getExistingArticleIds,
  getPendingArticles, getPendingArticlesCount, resetFailedArticles } from '../article-repository';
import { getCurrentCjSession, saveCjSession, invalidateCjSession } from '../cj-session-repository';
import { findCrawl, findActiveCrawl, withCrawlLock, recoverCrawls, updateOwnedCrawl,
  type CrawlDb, type CrawlSession } from '../crawl-repository';

export interface CrawlControllerDependencies {
  db: CrawlDb;
  getListPage?: typeof getListPage;
  getArticleDetail?: typeof getArticleDetail;
  delay?: (ms: number) => Promise<void>;
}

// Shared even between controller instances. New executions wait for all old requests to drain.
const queues = new WeakMap<CrawlDb, Promise<void>>();
function progress(row: CrawlSession): CrawlProgress {
  return {
    sessionId: String(row.id), status: row.status, phase: row.phase,
    pauseReason: row.pause_reason, startPage: row.start_page ?? 1,
    endPage: row.end_page ?? row.total_pages, nextPage: row.next_page ?? row.current_page + 1,
    skipExisting: row.skip_existing, recentTitles: row.recent_titles.slice(-10),
    currentPage: row.current_page, totalPages: row.total_pages, totalNews: row.total_news,
    pendingNews: row.pending_news, crawledNews: row.crawled_news, failedNews: row.failed_news,
    avgSpeed: row.avg_speed, estimatedTime: row.avg_speed > 0 ? Math.ceil(row.pending_news / row.avg_speed) : 0,
    startedAt: new Date(row.started_at), updatedAt: new Date(row.updated_at),
    finishedAt: row.finished_at ? new Date(row.finished_at) : null,
  };
}
function validate(config: CrawlTaskConfig) {
  if (!Number.isInteger(config.startPage) || !Number.isInteger(config.endPage) || config.startPage < 1 || config.endPage < config.startPage) throw new Error('无效的页码范围');
  if (config.endPage - config.startPage + 1 > CRAWL_CONFIG.MAX_PAGES_PER_TASK) throw new Error(`单次任务最多 ${CRAWL_CONFIG.MAX_PAGES_PER_TASK} 页`);
  if (config.idempotencyKey !== undefined && (!config.idempotencyKey.length || config.idempotencyKey.length > 200)) throw new Error('Invalid idempotency key');
}

export function createCrawlController(deps: CrawlControllerDependencies) {
  const db = deps.db;
  const list = deps.getListPage ?? getListPage;
  const detail = deps.getArticleDetail ?? getArticleDetail;
  const delay = deps.delay ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const ready = () => recoverCrawls(db);

  async function owned(id: string, generation: string) {
    const row = await findCrawl(id, db);
    return row?.status === 'running' && row.execution_id === generation ? row : null;
  }
  async function run(id: string, generation: string) {
    let row = await owned(id, generation);
    if (!row) return;
    const login = await getCurrentCjSession(db);
    if (row.phase === 'list' && !login) {
      await updateOwnedCrawl(id, generation, { status: 'paused', pause_reason: 'cj_login_required', execution_id: null }, db);
      return;
    }
    try {
      if (row.phase === 'list') {
        for (let page = row.next_page ?? 1; page <= (row.end_page ?? row.total_pages); page++) {
          row = await owned(id, generation); if (!row) return;
          const result = await list(page, login!.cookies!);
          if (!result) {
            await withCrawlLock(db, async trx => {
              const current = await findCrawl(id, trx);
              if (current?.status !== 'running' || current.execution_id !== generation) return;
              await invalidateCjSession(login!.id, trx);
              await updateOwnedCrawl(id, generation, { status: 'paused', pause_reason: 'cj_login_required', execution_id: null, next_page: page }, trx);
            });
            return;
          }
          // Commit the articles and cursor together, serialized with pause/cancel.
          // Otherwise a pause between insertion and cursor update loses the page's count on resume.
          await withCrawlLock(db, async trx => {
            const current = await findCrawl(id, trx);
            if (current?.status !== 'running' || current.execution_id !== generation) return;
            let articles = filterValidArticles(result.articles);
            if (current.skip_existing) {
              const existing = await getExistingArticleIds(articles.map(a => a.id), trx);
              articles = articles.filter(a => !existing.has(a.id));
            }
            const count = await insertArticles(articles, trx);
            const recent: RecentTitle[] = articles.map(a => ({ time: new Date().toISOString(), page, title: a.title, status: 'pending' }));
            await updateOwnedCrawl(id, generation, {
              current_page: page - (current.start_page ?? 1) + 1, next_page: page + 1,
              total_news: current.total_news + count, pending_news: await getPendingArticlesCount(trx),
              recent_titles: sql<RecentTitle[]>`${JSON.stringify([...current.recent_titles, ...recent].slice(-10))}::jsonb`,
            }, trx);
          });
          if (!await owned(id, generation)) return;
          await delay(CRAWL_CONFIG.LIST_PAGE_DELAY);
        }
        if (!await updateOwnedCrawl(id, generation, { phase: 'detail', pending_news: await getPendingArticlesCount(db) }, db)) return;
      }
      const began = Date.now(); let crawled = 0;
      while (await owned(id, generation)) {
        const articles = await getPendingArticles(CRAWL_CONFIG.BATCH_SIZE, db);
        if (!articles.length) {
          await updateOwnedCrawl(id, generation, { status: 'completed', phase: 'completed', pending_news: 0, execution_id: null, pending_execution: null, finished_at: new Date() }, db);
          return;
        }
        let index = 0;
        // A rejected worker must not release the execution queue while siblings still fetch.
        const results = await Promise.allSettled(Array.from({ length: Math.min(CRAWL_CONFIG.CONCURRENCY, articles.length) }, async () => {
          while (index < articles.length) {
            if (!await owned(id, generation)) return;
            if (index >= articles.length) return;
            const article = articles[index++];
            let title = article.source_id; let success = false;
            try {
              const value = await detail(article.source_id, article.source_url);
              await updateArticleDetail(value, db); title = value.title; success = true;
            } catch {
              // Do not persist upstream messages, which may contain authentication material.
              await markArticleFailed(article.source_id, 'Article fetch failed', db);
            }
            if (success) crawled++;
            // Parallel workers serialize counter/recent-title updates and lifecycle changes.
            await withCrawlLock(db, async trx => {
              const current = await findCrawl(id, trx);
              if (!current || current.execution_id !== generation || current.status !== 'running') return;
              await updateOwnedCrawl(id, generation, {
                crawled_news: current.crawled_news + (success ? 1 : 0),
                failed_news: current.failed_news + (success ? 0 : 1),
                pending_news: await getPendingArticlesCount(trx),
                avg_speed: Math.round(crawled / Math.max((Date.now() - began) / 60000, 0.1)),
                recent_titles: sql<RecentTitle[]>`${JSON.stringify([...current.recent_titles, { time: new Date().toISOString(), page: Math.max(current.start_page ?? 1, (current.next_page ?? 1) - 1), title, status: success ? 'crawled' : 'failed' }].slice(-10))}::jsonb`,
              }, trx);
            });
            await delay(200);
          }
        }));
        const rejected = results.find(result => result.status === 'rejected');
        if (rejected?.status === 'rejected') throw rejected.reason;
        if (await owned(id, generation)) await delay(CRAWL_CONFIG.DETAIL_PAGE_DELAY);
      }
    } catch {
      await updateOwnedCrawl(id, generation, { status: 'failed', execution_id: null, finished_at: new Date() }, db);
    }
  }
  function enqueue(row: CrawlSession) {
    if (row.status !== 'running' || !row.execution_id) return;
    const next = (queues.get(db) ?? Promise.resolve()).then(() => run(String(row.id), row.execution_id!));
    // Always attach rejection handling; callers can also await completion in tests/shutdown.
    queues.set(db, next.catch(async () => {
      await updateOwnedCrawl(String(row.id), row.execution_id!, { status: 'failed', execution_id: null, finished_at: new Date() }, db);
    }));
  }
  async function rememberCookie(cookie?: string) {
    if (cookie) await saveCjSession(cookie, new Date(Date.now() + 24 * 60 * 60 * 1000), db);
  }

  return {
    recover: ready,
    async start(config: CrawlTaskConfig): Promise<CrawlProgress> {
      validate(config); await ready();
      const result = await withCrawlLock(db, async trx => {
        if (config.idempotencyKey) {
          const previous = await trx.selectFrom('crawl_sessions').selectAll()
            .where('idempotency_key', '=', config.idempotencyKey)
            .where('started_at', '>=', sql<string>`now() - interval '10 minutes'`)
            .orderBy('id', 'desc').executeTakeFirst();
          if (previous) return { row: previous, existing: true };
        }
        const active = await findActiveCrawl(trx);
        if (active) return { row: active, existing: true };
        if (config.cookie) await saveCjSession(config.cookie, new Date(Date.now() + 86400000), trx);
        const login = await getCurrentCjSession(trx);
        const row = await trx.insertInto('crawl_sessions').values({
          session_name: `爬取 ${config.startPage}-${config.endPage} 页`,
          total_pages: config.endPage - config.startPage + 1, start_page: config.startPage,
          end_page: config.endPage, next_page: config.startPage, skip_existing: config.skipExisting,
          idempotency_key: config.idempotencyKey ?? null,
          status: login ? 'running' : 'paused', pause_reason: login ? null : 'cj_login_required',
          execution_id: login ? randomUUID() : null,
          pending_execution: JSON.stringify({ startPage: config.startPage, endPage: config.endPage, skipExisting: config.skipExisting }),
        }).returningAll().executeTakeFirstOrThrow();
        return { row, existing: false };
      });
      if (!result.existing) enqueue(result.row);
      const active = result.row.status === 'running' || result.row.status === 'paused';
      return {
        ...progress(result.row), already_running: result.existing && active,
        ...(result.existing && !active ? { idempotent_replay: true } : {}),
      };
    },
    async resume(id: string, cookie?: string): Promise<boolean> {
      await ready();
      const row = await withCrawlLock(db, async trx => {
        const current = await findCrawl(id, trx);
        if (current?.status !== 'paused') return null;
        const active = await findActiveCrawl(trx);
        if (active && String(active.id) !== id) return null;
        if (cookie) await saveCjSession(cookie, new Date(Date.now() + 86400000), trx);
        if (current.phase === 'list' && !await getCurrentCjSession(trx)) {
          await trx.updateTable('crawl_sessions').set({ pause_reason: 'cj_login_required', updated_at: new Date() }).where('id', '=', current.id).execute();
          return null;
        }
        return trx.updateTable('crawl_sessions').set({ status: 'running', pause_reason: null, execution_id: randomUUID(), updated_at: new Date() })
          .where('id', '=', current.id).returningAll().executeTakeFirstOrThrow();
      });
      if (!row) return false;
      enqueue(row); return true;
    },
    async pause(id: string): Promise<boolean> {
      await ready();
      return withCrawlLock(db, async trx => {
        const row = await findCrawl(id, trx);
        if (row?.status !== 'running') return false;
        await trx.updateTable('crawl_sessions').set({ status: 'paused', pause_reason: 'user_requested', execution_id: null, updated_at: new Date() }).where('id', '=', row.id).execute();
        return true;
      });
    },
    async cancel(id: string): Promise<boolean> {
      await ready();
      return withCrawlLock(db, async trx => {
        const row = await findCrawl(id, trx);
        if (!row || !['running', 'paused'].includes(row.status)) return false;
        await trx.updateTable('crawl_sessions').set({ status: 'cancelled', pause_reason: null, execution_id: null, pending_execution: null, finished_at: new Date(), updated_at: new Date() }).where('id', '=', row.id).execute();
        return true;
      });
    },
    async getStatus(id: string): Promise<CrawlProgress | null> {
      await ready(); const row = await findCrawl(id, db); return row ? progress(row) : null;
    },
    async getCurrent(): Promise<CrawlProgress | null> {
      await ready(); const row = await findActiveCrawl(db); return row ? progress(row) : null;
    },
    async retryFailed(cookie?: string) { await ready(); await rememberCookie(cookie); return { count: await resetFailedArticles(db) }; },
    async waitForIdle() {
      let queue: Promise<void> | undefined;
      do { queue = queues.get(db); await queue; } while (queue !== queues.get(db));
    },
  };
}

let shared: ReturnType<typeof createCrawlController> | undefined;
export function getCrawlController() { return shared ??= createCrawlController({ db: getDb() }); }
export const startCrawlTask = (config: CrawlTaskConfig) => getCrawlController().start(config);
export const pauseCrawlTask = (id: string) => getCrawlController().pause(id);
export const resumeCrawlTask = (id: string, cookie?: string) => getCrawlController().resume(id, cookie);
export const cancelCrawlTask = (id: string) => getCrawlController().cancel(id);
export const getCrawlTaskStatus = (id: string) => getCrawlController().getStatus(id);
export const getCurrentRunningTask = () => getCrawlController().getCurrent();
export const retryFailedArticles = (cookie?: string) => getCrawlController().retryFailed(cookie);
export const recoverCrawlTasks = () => getCrawlController().recover();
