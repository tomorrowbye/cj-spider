import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { ArticleDetail, ArticleListItem, CrawlStatus } from "./crawl/types";

// Supabase 客户端单例
let supabaseClient: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (!supabaseClient) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      throw new Error("Missing Supabase environment variables");
    }

    supabaseClient = createClient(supabaseUrl, supabaseKey);
  }
  return supabaseClient;
}

// ==================== 新闻表操作 ====================

/**
 * 批量插入新文章 (列表阶段)
 */
export async function insertArticles(
  articles: ArticleListItem[],
): Promise<number> {
  const supabase = getSupabaseClient();

  const records = articles.map((article) => ({
    source_id: article.id,
    title: article.title,
    source_url: article.link,
    category: article.topic,
    publish_time: parseDateTime(article.createdTime),
    status: "pending" as CrawlStatus,
  }));

  // 使用 upsert 避免重复插入，但只在不存在时插入
  const { data, error } = await supabase
    .from("news")
    .upsert(records, {
      onConflict: "source_id",
      ignoreDuplicates: true,
    })
    .select("id");

  if (error) {
    console.error("插入文章失败:", error);
    throw error;
  }

  return data?.length || 0;
}

/**
 * 更新文章详情
 */
export async function updateArticleDetail(
  detail: ArticleDetail,
): Promise<void> {
  const supabase = getSupabaseClient();

  const { error } = await supabase
    .from("news")
    .update({
      title: detail.title,
      content: detail.content,
      content_text: detail.contentText,
      author: detail.author,
      source_name: detail.source,
      category: detail.topic,
      region: detail.area,
      publish_time: parseDateTime(detail.createdTime),
      status: "crawled" as CrawlStatus,
      crawl_time: new Date().toISOString(),
      raw_html: detail.rawHtml,
    })
    .eq("source_id", detail.id);

  if (error) {
    console.error("更新文章详情失败:", error);
    throw error;
  }
}

/**
 * 标记文章为失败
 */
export async function markArticleFailed(
  sourceId: string,
  errorMessage: string,
): Promise<void> {
  const supabase = getSupabaseClient();

  const { error } = await supabase
    .from("news")
    .update({
      status: "failed" as CrawlStatus,
      error_message: errorMessage,
    })
    .eq("source_id", sourceId);

  if (error) {
    console.error("标记文章失败状态失败:", error);
    throw error;
  }
}

/**
 * 获取待爬取的文章
 */
export async function getPendingArticles(
  limit: number = 100,
): Promise<{ source_id: string; source_url: string }[]> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from("news")
    .select("source_id, source_url")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) {
    console.error("获取待爬取文章失败:", error);
    throw error;
  }

  return data || [];
}

/**
 * 获取待爬取文章数量
 */
export async function getPendingArticlesCount(): Promise<number> {
  const supabase = getSupabaseClient();

  const { count, error } = await supabase
    .from("news")
    .select("*", { count: "exact", head: true })
    .eq("status", "pending");

  if (error) {
    console.error("获取待爬取文章数量失败:", error);
    throw error;
  }

  return count || 0;
}

/**
 * 检查文章是否已存在
 */
export async function getExistingArticleIds(
  sourceIds: string[],
): Promise<Set<string>> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from("news")
    .select("source_id")
    .in("source_id", sourceIds);

  if (error) {
    console.error("检查文章是否存在失败:", error);
    throw error;
  }

  return new Set(data?.map((item) => item.source_id) || []);
}

/**
 * 获取新闻统计
 */
export async function getNewsStats(): Promise<{
  total: number;
  pending: number;
  crawled: number;
  failed: number;
}> {
  const supabase = getSupabaseClient();

  // 使用并发请求获取各个状态的统计
  // 注意：使用 count: "exact" 和 head: true 来只获取计数，不获取数据
  const [totalResult, pendingResult, crawledResult, failedResult] =
    await Promise.all([
      supabase.from("news").select("*", { count: "exact", head: true }),
      supabase
        .from("news")
        .select("*", { count: "exact", head: true })
        .eq("status", "pending"),
      supabase
        .from("news")
        .select("*", { count: "exact", head: true })
        .eq("status", "crawled"),
      supabase
        .from("news")
        .select("*", { count: "exact", head: true })
        .eq("status", "failed"),
    ]);

  if (totalResult.error) {
    console.error("获取总数统计失败:", totalResult.error);
    throw totalResult.error;
  }

  return {
    total: totalResult.count || 0,
    pending: pendingResult.count || 0,
    crawled: crawledResult.count || 0,
    failed: failedResult.count || 0,
  };
}

// ==================== 爬取会话操作 ====================

/**
 * 创建爬取会话
 */
export async function createCrawlSession(config: {
  sessionName: string;
  totalPages: number;
}): Promise<string> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from("crawl_sessions")
    .insert({
      session_name: config.sessionName,
      total_pages: config.totalPages,
      current_page: 0,
      total_news: 0,
      crawled_news: 0,
      failed_news: 0,
      pending_news: 0,
      phase: "list",
      avg_speed: 0,
      status: "running",
    })
    .select("id")
    .single();

  if (error) {
    console.error("创建爬取会话失败:", error);
    throw error;
  }

  return data.id.toString();
}

/**
 * 更新爬取会话进度
 */
export async function updateCrawlSession(
  sessionId: string,
  updates: {
    currentPage?: number;
    totalNews?: number;
    crawledNews?: number;
    failedNews?: number;
    pendingNews?: number;
    phase?: "list" | "detail" | "completed";
    avgSpeed?: number;
    status?: "running" | "paused" | "completed" | "failed";
  },
): Promise<void> {
  const supabase = getSupabaseClient();

  const updateData: Record<string, unknown> = {};
  if (updates.currentPage !== undefined)
    updateData.current_page = updates.currentPage;
  if (updates.totalNews !== undefined)
    updateData.total_news = updates.totalNews;
  if (updates.crawledNews !== undefined)
    updateData.crawled_news = updates.crawledNews;
  if (updates.failedNews !== undefined)
    updateData.failed_news = updates.failedNews;
  if (updates.pendingNews !== undefined)
    updateData.pending_news = updates.pendingNews;
  if (updates.phase !== undefined) updateData.phase = updates.phase;
  if (updates.avgSpeed !== undefined) updateData.avg_speed = updates.avgSpeed;
  if (updates.status !== undefined) {
    updateData.status = updates.status;
    if (updates.status === "completed" || updates.status === "failed") {
      updateData.finished_at = new Date().toISOString();
    }
  }

  const { error } = await supabase
    .from("crawl_sessions")
    .update(updateData)
    .eq("id", sessionId);

  if (error) {
    console.error("更新爬取会话失败:", error);
    throw error;
  }
}

/**
 * 获取爬取会话
 */
export async function getCrawlSession(sessionId: string) {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from("crawl_sessions")
    .select("*")
    .eq("id", sessionId)
    .single();

  if (error) {
    console.error("获取爬取会话失败:", error);
    return null;
  }

  return data;
}

// ==================== 工具函数 ====================

/**
 * 解析日期时间字符串
 */
function parseDateTime(dateStr: string): string | null {
  if (!dateStr) return null;

  // 尝试直接解析
  const date = new Date(dateStr);
  if (!isNaN(date.getTime())) {
    return date.toISOString();
  }

  // 尝试解析中文格式: 2025-12-24 19:49:52
  // 新闻网站显示的时间是北京时间(东8区),需要明确指定时区
  const match = dateStr.match(
    /(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/,
  );
  if (match) {
    const [, year, month, day, hour, minute, second] = match;
    // 添加 +08:00 时区标识,明确表示这是北京时间
    return new Date(
      `${year}-${month}-${day}T${hour}:${minute}:${second}+08:00`,
    ).toISOString();
  }

  return null;
}
