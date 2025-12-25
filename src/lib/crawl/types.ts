// 爬取相关类型定义

export interface ArticleListItem {
  id: string; // 文章ID (source_id)
  link: string; // 文章链接
  title: string; // 标题
  topic: string; // 分类
  createdTime: string; // 发布时间
  status: string; // 状态 (通过/待审核等)
}

export interface ListPageResult {
  page: number;
  total: number;
  articles: ArticleListItem[];
}

export interface ArticleDetail {
  id: string;
  title: string;
  content: string; // HTML 内容
  contentText: string; // 纯文本内容
  source: string; // 来源
  author: string; // 作者
  topic: string; // 分类
  area: string; // 地区
  createdTime: string; // 发布时间
  rawHtml?: string; // 原始 HTML
}

export interface CrawlTaskConfig {
  startPage: number;
  endPage: number;
  skipExisting: boolean;
  cookie: string;
}

export interface CrawlProgress {
  sessionId: string;
  status: "running" | "paused" | "completed" | "failed";
  phase: "list" | "detail" | "completed"; // 当前阶段
  currentPage: number;
  totalPages: number;
  totalNews: number; // 发现的文章总数
  pendingNews: number; // 待爬取数
  crawledNews: number; // 已爬取数
  failedNews: number; // 失败数
  avgSpeed: number; // 平均速度 (篇/分钟)
  estimatedTime: number; // 预估剩余时间 (分钟)
  startedAt: Date;
  updatedAt: Date;
  error?: string;
}

export type CrawlStatus = "pending" | "crawled" | "failed";
