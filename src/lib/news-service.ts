import { getSupabaseClient } from "./supabase";

export interface NewsSearchParams {
  // 精确搜索
  author?: string;
  region?: string;
  sourceName?: string;
  category?: string;
  startDate?: string;
  endDate?: string;
  status?: string;

  // 模糊搜索
  keyword?: string; // 标题和作者模糊搜索（兼容旧版）
  title?: string; // 仅标题模糊搜索

  // 分页
  page?: number;
  pageSize?: number;

  // 排序
  orderBy?: string;
  order?: "asc" | "desc";
}

export interface NewsItem {
  id: number;
  source_id: string;
  title: string;
  author: string | null;
  source_name: string | null;
  region: string | null;
  category: string | null;
  publish_time: string | null;
  status: string;
  created_at: string;
}

export interface NewsListResult {
  data: NewsItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/**
 * 查询新闻列表
 */
export async function getNewsList(
  params: NewsSearchParams,
): Promise<NewsListResult> {
  const supabase = getSupabaseClient();

  const {
    author,
    region,
    sourceName,
    category,
    startDate,
    endDate,
    status,
    keyword,
    title,
    page = 1,
    pageSize = 20,
    orderBy = "source_id",
    order = "desc",
  } = params;

  // 构建查询
  let query = supabase
    .from("news")
    .select(
      "id, source_id, title, author, source_name, region, category, publish_time, status, created_at",
      { count: "exact" },
    );

  // 作者模糊搜索
  if (author) {
    query = query.ilike("author", `%${author}%`);
  }
  // 精确过滤
  if (region) {
    query = query.eq("region", region);
  }
  if (sourceName) {
    query = query.eq("source_name", sourceName);
  }
  if (category) {
    query = query.eq("category", category);
  }
  if (status) {
    query = query.eq("status", status);
  }

  // 时间范围
  if (startDate) {
    query = query.gte("publish_time", startDate);
  }
  if (endDate) {
    query = query.lte("publish_time", endDate);
  }

  // 仅标题搜索
  if (title) {
    query = query.ilike("title", `%${title}%`);
  }

  // 模糊搜索 (标题或作者) - 兼容旧版
  if (keyword) {
    query = query.or(`title.ilike.%${keyword}%,author.ilike.%${keyword}%`);
  }

  // 排序
  query = query.order(orderBy, { ascending: order === "asc" });

  // 分页
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  query = query.range(from, to);

  const { data, error, count } = await query;

  if (error) {
    console.error("查询新闻列表失败:", error);
    throw error;
  }

  const total = count || 0;

  return {
    data: data || [],
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

/**
 * 获取所有符合条件的新闻 (用于导出)
 */
export async function getNewsForExport(
  params: Omit<NewsSearchParams, "page" | "pageSize">,
): Promise<NewsItem[]> {
  const supabase = getSupabaseClient();

  const {
    author,
    region,
    sourceName,
    category,
    startDate,
    endDate,
    status,
    keyword,
    title,
    orderBy = "source_id",
    order = "desc",
  } = params;

  // 构建查询
  let query = supabase
    .from("news")
    .select(
      "id, source_id, title, author, source_name, region, category, publish_time, status, created_at, content_text",
    );

  // 作者模糊搜索
  if (author) {
    query = query.ilike("author", `%${author}%`);
  }
  // 精确过滤
  if (region) {
    query = query.eq("region", region);
  }
  if (sourceName) {
    query = query.eq("source_name", sourceName);
  }
  if (category) {
    query = query.eq("category", category);
  }
  if (status) {
    query = query.eq("status", status);
  }

  // 时间范围
  if (startDate) {
    query = query.gte("publish_time", startDate);
  }
  if (endDate) {
    query = query.lte("publish_time", endDate);
  }

  // 仅标题搜索
  if (title) {
    query = query.ilike("title", `%${title}%`);
  }

  // 模糊搜索 - 兼容旧版
  if (keyword) {
    query = query.or(`title.ilike.%${keyword}%,author.ilike.%${keyword}%`);
  }

  // 排序
  query = query.order(orderBy, { ascending: order === "asc" });

  const { data, error } = await query;

  if (error) {
    console.error("查询导出数据失败:", error);
    throw error;
  }

  return data || [];
}

/**
 * 获取筛选选项 (去重的作者、地区、来源、分类列表)
 */
export async function getFilterOptions(): Promise<{
  authors: string[];
  regions: string[];
  sourceNames: string[];
  categories: string[];
}> {
  const supabase = getSupabaseClient();

  // 并行查询
  const [authorsRes, regionsRes, sourceNamesRes, categoriesRes] =
    await Promise.all([
      supabase.from("news").select("author").not("author", "is", null),
      supabase.from("news").select("region").not("region", "is", null),
      supabase
        .from("news")
        .select("source_name")
        .not("source_name", "is", null),
      supabase.from("news").select("category").not("category", "is", null),
    ]);

  // 去重
  const authors = [
    ...new Set(authorsRes.data?.map((d) => d.author).filter(Boolean) || []),
  ].sort();
  const regions = [
    ...new Set(regionsRes.data?.map((d) => d.region).filter(Boolean) || []),
  ].sort();
  const sourceNames = [
    ...new Set(
      sourceNamesRes.data?.map((d) => d.source_name).filter(Boolean) || [],
    ),
  ].sort();
  const categories = [
    ...new Set(
      categoriesRes.data?.map((d) => d.category).filter(Boolean) || [],
    ),
  ].sort();

  return { authors, regions, sourceNames, categories };
}
