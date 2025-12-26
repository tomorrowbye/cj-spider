import { CRAWL_CONFIG } from "./config";
import { getListPage, filterValidArticles } from "./list-parser";
import { getArticleDetail } from "./detail-parser";
import { CrawlTaskConfig, CrawlProgress } from "./types";
import {
  insertArticles,
  updateArticleDetail,
  markArticleFailed,
  getExistingArticleIds,
  createCrawlSession,
  updateCrawlSession,
  getCrawlSession,
  getPendingArticles,
  getPendingArticlesCount,
} from "../supabase";

// 任务状态存储 (内存中，生产环境可用 Redis)
const taskStates = new Map<
  string,
  {
    status: "running" | "paused" | "completed" | "failed";
    detailStartTime?: number;
    crawledInSession?: number;
  }
>();

/**
 * 延迟函数
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 检查任务是否应该继续
 */
function shouldContinue(sessionId: string): boolean {
  const state = taskStates.get(sessionId);
  return state?.status === "running";
}

/**
 * 计算平均速度 (篇/分钟)
 */
function calculateSpeed(crawled: number, startTime: number): number {
  const elapsed = (Date.now() - startTime) / 60000; // 分钟
  if (elapsed < 0.1) return 0;
  return Math.round((crawled / elapsed) * 10) / 10;
}

/**
 * 启动爬取任务
 */
export async function startCrawlTask(
  config: CrawlTaskConfig,
): Promise<CrawlProgress> {
  const { startPage, endPage } = config;

  // 验证配置
  if (startPage < 1 || endPage < startPage) {
    throw new Error("无效的页码范围");
  }

  const totalPages = endPage - startPage + 1;
  if (totalPages > CRAWL_CONFIG.MAX_PAGES_PER_TASK) {
    throw new Error(`单次任务最多 ${CRAWL_CONFIG.MAX_PAGES_PER_TASK} 页`);
  }

  // 创建会话
  const sessionName = `爬取 ${startPage}-${endPage} 页`;
  const sessionId = await createCrawlSession({
    sessionName,
    totalPages,
  });

  // 初始化任务状态
  taskStates.set(sessionId, { status: "running" });

  // 异步执行爬取 (不阻塞返回)
  executeCrawlTask(sessionId, config).catch((error) => {
    console.error("爬取任务执行失败:", error);
    updateCrawlSession(sessionId, { status: "failed" });
    taskStates.set(sessionId, { status: "failed" });
  });

  return {
    sessionId,
    status: "running",
    phase: "list",
    currentPage: 0,
    totalPages,
    totalNews: 0,
    pendingNews: 0,
    crawledNews: 0,
    failedNews: 0,
    avgSpeed: 0,
    estimatedTime: 0,
    startedAt: new Date(),
    updatedAt: new Date(),
  };
}

/**
 * 执行爬取任务 (内部函数)
 */
async function executeCrawlTask(
  sessionId: string,
  config: CrawlTaskConfig,
): Promise<void> {
  const { startPage, endPage, skipExisting, cookie } = config;

  let totalNews = 0;
  let crawledNews = 0;
  let failedNews = 0;

  try {
    // 阶段1: 爬取列表页
    console.log(`[${sessionId}] 开始爬取列表页 ${startPage} - ${endPage}`);

    await updateCrawlSession(sessionId, { phase: "list" });

    for (let page = startPage; page <= endPage; page++) {
      if (!shouldContinue(sessionId)) {
        console.log(`[${sessionId}] 任务已暂停或取消`);
        return;
      }

      console.log(`[${sessionId}] 爬取第 ${page} 页`);

      const result = await getListPage(page, cookie);

      if (!result) {
        console.error(`[${sessionId}] 第 ${page} 页需要登录`);
        await updateCrawlSession(sessionId, { status: "failed" });
        taskStates.set(sessionId, { status: "failed" });
        return;
      }

      // 过滤有效文章
      let articles = filterValidArticles(result.articles);

      // 跳过已存在的文章
      if (skipExisting && articles.length > 0) {
        const existingIds = await getExistingArticleIds(
          articles.map((a) => a.id),
        );
        articles = articles.filter((a) => !existingIds.has(a.id));
      }

      // 插入新文章
      if (articles.length > 0) {
        const inserted = await insertArticles(articles);
        totalNews += inserted;
        console.log(`[${sessionId}] 第 ${page} 页插入 ${inserted} 篇文章`);
      }

      // 更新进度 - 使用相对页码而非绝对页码
      await updateCrawlSession(sessionId, {
        currentPage: page - startPage + 1,
        totalNews,
        pendingNews: totalNews,
      });

      // 延迟
      await delay(CRAWL_CONFIG.LIST_PAGE_DELAY);
    }

    // 阶段2: 并发爬取详情页
    console.log(
      `[${sessionId}] 开始并发爬取详情页 (并发数: ${CRAWL_CONFIG.CONCURRENCY})`,
    );

    // 获取实际待爬取数量
    const pendingCount = await getPendingArticlesCount();

    await updateCrawlSession(sessionId, {
      phase: "detail",
      pendingNews: pendingCount,
    });

    // 记录详情爬取开始时间
    const detailStartTime = Date.now();
    taskStates.set(sessionId, {
      ...taskStates.get(sessionId)!,
      detailStartTime,
      crawledInSession: 0,
    });

    let batchCount = 0;

    while (shouldContinue(sessionId)) {
      const pendingArticles = await getPendingArticles(CRAWL_CONFIG.BATCH_SIZE);

      if (pendingArticles.length === 0) {
        console.log(`[${sessionId}] 没有待爬取的文章了`);
        break;
      }

      console.log(
        `[${sessionId}] 开始处理第 ${batchCount + 1} 批，共 ${pendingArticles.length} 篇`,
      );

      // 并发爬取详情
      const results = await crawlDetailsConcurrently(
        sessionId,
        pendingArticles,
        CRAWL_CONFIG.CONCURRENCY,
      );

      // 统计结果
      for (const result of results) {
        if (result.success) {
          crawledNews++;
        } else {
          failedNews++;
        }
      }

      // 更新任务状态中的爬取数
      const state = taskStates.get(sessionId);
      if (state) {
        state.crawledInSession = crawledNews;
      }

      // 计算速度和剩余时间
      const avgSpeed = calculateSpeed(crawledNews, detailStartTime);
      const remainingPending = await getPendingArticlesCount();

      // 更新进度
      await updateCrawlSession(sessionId, {
        crawledNews,
        failedNews,
        pendingNews: remainingPending,
        avgSpeed,
      });

      batchCount++;
      console.log(
        `[${sessionId}] 完成第 ${batchCount} 批，已爬取 ${crawledNews} 篇，失败 ${failedNews} 篇，速度 ${avgSpeed} 篇/分钟`,
      );

      // 批次间延迟
      if (shouldContinue(sessionId)) {
        await delay(CRAWL_CONFIG.DETAIL_PAGE_DELAY);
      }
    }

    // 完成
    await updateCrawlSession(sessionId, {
      status: "completed",
      phase: "completed",
      pendingNews: 0,
    });
    taskStates.set(sessionId, { status: "completed" });
    console.log(
      `[${sessionId}] 任务完成，共爬取 ${crawledNews} 篇，失败 ${failedNews} 篇`,
    );
  } catch (error) {
    console.error(`[${sessionId}] 任务执行出错:`, error);
    await updateCrawlSession(sessionId, { status: "failed" });
    taskStates.set(sessionId, { status: "failed" });
    throw error;
  }
}

/**
 * 并发爬取详情页
 */
async function crawlDetailsConcurrently(
  sessionId: string,
  articles: Array<{ source_id: string; source_url: string }>,
  concurrency: number,
): Promise<Array<{ source_id: string; success: boolean; error?: string }>> {
  const results: Array<{
    source_id: string;
    success: boolean;
    error?: string;
  }> = [];
  const queue = [...articles];
  const executing: Promise<void>[] = [];

  const processArticle = async (article: {
    source_id: string;
    source_url: string;
  }) => {
    if (!shouldContinue(sessionId)) {
      return;
    }

    try {
      console.log(`[${sessionId}] 爬取文章 ${article.source_id}`);
      const detail = await getArticleDetail(
        article.source_id,
        article.source_url,
      );
      await updateArticleDetail(detail);
      results.push({ source_id: article.source_id, success: true });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "未知错误";
      console.error(
        `[${sessionId}] 文章 ${article.source_id} 爬取失败:`,
        errorMsg,
      );
      await markArticleFailed(article.source_id, errorMsg);
      results.push({
        source_id: article.source_id,
        success: false,
        error: errorMsg,
      });
    }

    // 单个请求间的小延迟，避免请求过于密集
    await delay(200);
  };

  // 使用并发池处理
  while (queue.length > 0 || executing.length > 0) {
    // 填充执行池
    while (executing.length < concurrency && queue.length > 0) {
      const article = queue.shift()!;
      const promise = processArticle(article).then(() => {
        const index = executing.indexOf(promise);
        if (index > -1) {
          executing.splice(index, 1);
        }
      });
      executing.push(promise);
    }

    // 等待至少一个完成
    if (executing.length > 0) {
      await Promise.race(executing);
    }
  }

  return results;
}

/**
 * 暂停任务
 */
export async function pauseCrawlTask(sessionId: string): Promise<boolean> {
  const state = taskStates.get(sessionId);
  if (!state || state.status !== "running") {
    return false;
  }

  taskStates.set(sessionId, { ...state, status: "paused" });
  await updateCrawlSession(sessionId, { status: "paused" });
  return true;
}

/**
 * 继续任务 (从 pending 文章继续爬取详情)
 */
export async function resumeCrawlTask(
  sessionId: string,
  cookie: string,
): Promise<boolean> {
  const session = await getCrawlSession(sessionId);
  if (!session || session.status !== "paused") {
    return false;
  }

  taskStates.set(sessionId, { status: "running" });
  await updateCrawlSession(sessionId, { status: "running" });

  // 继续爬取详情
  executeCrawlTask(sessionId, {
    startPage: session.current_page + 1,
    endPage: session.current_page + session.total_pages,
    skipExisting: true,
    cookie,
  }).catch((error) => {
    console.error("继续爬取任务失败:", error);
    updateCrawlSession(sessionId, { status: "failed" });
    taskStates.set(sessionId, { status: "failed" });
  });

  return true;
}

/**
 * 获取任务状态
 */
export async function getCrawlTaskStatus(
  sessionId: string,
): Promise<CrawlProgress | null> {
  const session = await getCrawlSession(sessionId);
  if (!session) {
    return null;
  }

  // 计算预估剩余时间
  let estimatedTime = 0;
  if (
    session.phase === "detail" &&
    session.avg_speed > 0 &&
    session.pending_news > 0
  ) {
    estimatedTime = Math.ceil(session.pending_news / session.avg_speed);
  }

  return {
    sessionId,
    status: session.status,
    phase: session.phase || "list",
    currentPage: session.current_page,
    totalPages: session.total_pages,
    totalNews: session.total_news,
    pendingNews: session.pending_news || 0,
    crawledNews: session.crawled_news,
    failedNews: session.failed_news || 0,
    avgSpeed: session.avg_speed || 0,
    estimatedTime,
    startedAt: new Date(session.started_at),
    updatedAt: new Date(),
  };
}

/**
 * 重试失败的文章
 */
export async function retryFailedArticles(
  cookie: string,
): Promise<{ count: number }> {
  const { getSupabaseClient } = await import("../supabase");
  const supabase = getSupabaseClient();

  // 将 failed 状态改为 pending
  const { data, error } = await supabase
    .from("news")
    .update({ status: "pending", error_message: null })
    .eq("status", "failed")
    .select("id");

  if (error) {
    throw error;
  }

  return { count: data?.length || 0 };
}
