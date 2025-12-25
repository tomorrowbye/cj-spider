// 爬取配置

export const CRAWL_CONFIG = {
  // 请求间隔 (毫秒)
  LIST_PAGE_DELAY: 1000, // 列表页间隔，从 2000 减少到 1000
  DETAIL_PAGE_DELAY: 500, // 详情页间隔，从 1500 减少到 500

  // 并发控制
  CONCURRENCY: 5, // 同时爬取的详情页数量
  BATCH_SIZE: 20, // 每批处理的文章数，从 10 增加到 20

  // 限制
  MAX_PAGES_PER_TASK: 100, // 单次任务最大页数，从 50 增加到 100

  // 重试
  MAX_RETRIES: 3,
  RETRY_DELAY: 3000, // 重试延迟，从 5000 减少到 3000

  // 存储
  SAVE_RAW_HTML: false,
};

// 地区关键词映射
export const AREA_KEYWORDS: Record<string, string[]> = {
  屯溪区: ["屯溪"],
  黟县: ["黟县"],
  祁门县: ["祁门"],
  歙县: ["歙县"],
  休宁县: ["休宁"],
  黄山区: ["黄山区"],
  徽州区: ["徽州区"],
};

export const DEFAULT_AREA = "黄山";

// 文章状态 - 只有这个状态的文章才能被爬取
export const VALID_ARTICLE_STATUS = "通过";
