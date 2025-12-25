# 数据库设计 - Supabase

## 项目信息
- Project: spider-cj
- 数据库: PostgreSQL (Supabase)

---

## 表结构设计

### 1. news (新闻表)

```sql
CREATE TABLE news (
    id BIGSERIAL PRIMARY KEY,
    source_id VARCHAR(20) NOT NULL UNIQUE,   -- 原站ID，如 605328
    title VARCHAR(500) NOT NULL,              -- 新闻标题
    content TEXT,                             -- 新闻正文（HTML）
    content_text TEXT,                        -- 纯文本内容（无HTML标签）
    summary TEXT,                             -- 摘要/简介
    author VARCHAR(100),                      -- 作者
    source_name VARCHAR(100),                 -- 来源媒体，如"市场星报"
    region VARCHAR(50),                       -- 地区标签，如"黄山"
    category VARCHAR(50),                     -- 分类，如"新闻 > 黄山"
    tags TEXT[],                              -- 标签数组
    view_count INT DEFAULT 0,                 -- 浏览次数
    share_count INT DEFAULT 0,                -- 分享次数
    images JSONB,                             -- 图片URLs数组 [{url, caption, order}]
    qr_codes JSONB,                           -- 二维码信息 [{type, url, desc}]
    contact_info JSONB,                       -- 联系方式 {phones, email, address}
    related_links JSONB,                      -- 相关链接 [{title, url}]
    source_url VARCHAR(500),                  -- 原文链接
    publish_time TIMESTAMP,                   -- 发布时间（原站）
    crawl_time TIMESTAMP,                     -- 爬取时间
    status VARCHAR(20) DEFAULT 'pending',     -- 爬取状态: pending/crawled/failed
    error_message TEXT,                       -- 错误信息（如果爬取失败）
    raw_html TEXT,                            -- 原始HTML（可选，用于调试）
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- 索引
CREATE INDEX idx_news_source_id ON news(source_id);
CREATE INDEX idx_news_region ON news(region);
CREATE INDEX idx_news_category ON news(category);
CREATE INDEX idx_news_source_name ON news(source_name);
CREATE INDEX idx_news_publish_time ON news(publish_time);
CREATE INDEX idx_news_status ON news(status);
CREATE INDEX idx_news_tags ON news USING gin(tags);
CREATE INDEX idx_news_title_fts ON news USING gin(to_tsvector('chinese', title));
CREATE INDEX idx_news_content_fts ON news USING gin(to_tsvector('chinese', content_text));
```

### 2. crawl_tasks (爬取任务表)

```sql
CREATE TABLE crawl_tasks (
    id BIGSERIAL PRIMARY KEY,
    task_type VARCHAR(20) NOT NULL,          -- 任务类型: list/detail
    target_url VARCHAR(500) NOT NULL,        -- 目标URL
    page_num INT,                            -- 页码（列表任务）
    news_source_id VARCHAR(20),              -- 关联新闻ID（详情任务）
    status VARCHAR(20) DEFAULT 'pending',    -- 状态: pending/running/completed/failed
    retry_count INT DEFAULT 0,               -- 重试次数
    error_message TEXT,                      -- 错误信息
    created_at TIMESTAMP DEFAULT NOW(),
    completed_at TIMESTAMP
);

-- 索引
CREATE INDEX idx_crawl_tasks_status ON crawl_tasks(status);
CREATE INDEX idx_crawl_tasks_type ON crawl_tasks(task_type);
```

### 3. crawl_sessions (爬取会话表)

```sql
CREATE TABLE crawl_sessions (
    id BIGSERIAL PRIMARY KEY,
    session_name VARCHAR(100),               -- 会话名称
    total_pages INT,                         -- 总页数
    current_page INT DEFAULT 0,              -- 当前页码
    total_news INT,                          -- 总新闻数
    crawled_news INT DEFAULT 0,              -- 已爬取数
    status VARCHAR(20) DEFAULT 'running',    -- 状态: running/paused/completed
    started_at TIMESTAMP DEFAULT NOW(),
    finished_at TIMESTAMP
);
```

### 4. login_sessions (登录会话表)

```sql
CREATE TABLE login_sessions (
    id BIGSERIAL PRIMARY KEY,
    cookies TEXT,                            -- Cookie JSON
    user_agent VARCHAR(500),                 -- User-Agent
    is_valid BOOLEAN DEFAULT TRUE,           -- 是否有效
    created_at TIMESTAMP DEFAULT NOW(),
    expires_at TIMESTAMP                     -- 过期时间
);
```

---

## Supabase SQL 执行脚本

在 Supabase SQL Editor 中执行以下完整脚本：

```sql
-- ============================================
-- CJ-SPIDER 数据库初始化脚本
-- ============================================

-- 1. 新闻表
CREATE TABLE IF NOT EXISTS news (
    id BIGSERIAL PRIMARY KEY,
    source_id VARCHAR(20) NOT NULL UNIQUE,
    title VARCHAR(500) NOT NULL,
    content TEXT,
    content_text TEXT,
    summary TEXT,
    author VARCHAR(100),
    source_name VARCHAR(100),
    region VARCHAR(50),
    category VARCHAR(50),
    tags TEXT[],
    view_count INT DEFAULT 0,
    share_count INT DEFAULT 0,
    images JSONB,
    qr_codes JSONB,
    contact_info JSONB,
    related_links JSONB,
    source_url VARCHAR(500),
    publish_time TIMESTAMP,
    crawl_time TIMESTAMP,
    status VARCHAR(20) DEFAULT 'pending',
    error_message TEXT,
    raw_html TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_news_source_id ON news(source_id);
CREATE INDEX IF NOT EXISTS idx_news_region ON news(region);
CREATE INDEX IF NOT EXISTS idx_news_category ON news(category);
CREATE INDEX IF NOT EXISTS idx_news_source_name ON news(source_name);
CREATE INDEX IF NOT EXISTS idx_news_publish_time ON news(publish_time);
CREATE INDEX IF NOT EXISTS idx_news_status ON news(status);
CREATE INDEX IF NOT EXISTS idx_news_tags ON news USING gin(tags);
CREATE INDEX IF NOT EXISTS idx_news_title_fts ON news USING gin(to_tsvector('chinese', title));
CREATE INDEX IF NOT EXISTS idx_news_content_fts ON news USING gin(to_tsvector('chinese', content_text));

-- 2. 爬取任务表
CREATE TABLE IF NOT EXISTS crawl_tasks (
    id BIGSERIAL PRIMARY KEY,
    task_type VARCHAR(20) NOT NULL,
    target_url VARCHAR(500) NOT NULL,
    page_num INT,
    news_source_id VARCHAR(20),
    status VARCHAR(20) DEFAULT 'pending',
    retry_count INT DEFAULT 0,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    completed_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_crawl_tasks_status ON crawl_tasks(status);
CREATE INDEX IF NOT EXISTS idx_crawl_tasks_type ON crawl_tasks(task_type);

-- 3. 爬取会话表
CREATE TABLE IF NOT EXISTS crawl_sessions (
    id BIGSERIAL PRIMARY KEY,
    session_name VARCHAR(100),
    total_pages INT,
    current_page INT DEFAULT 0,
    total_news INT,
    crawled_news INT DEFAULT 0,
    status VARCHAR(20) DEFAULT 'running',
    started_at TIMESTAMP DEFAULT NOW(),
    finished_at TIMESTAMP
);

-- 4. 登录会话表
CREATE TABLE IF NOT EXISTS login_sessions (
    id BIGSERIAL PRIMARY KEY,
    cookies TEXT,
    user_agent VARCHAR(500),
    is_valid BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    expires_at TIMESTAMP
);

-- 5. 更新时间触发器
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER news_updated_at
    BEFORE UPDATE ON news
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();
```

---

## 字段说明

### news 表核心字段

#### 基础信息
- `source_id`: 原站新闻ID（从URL提取，如 `/1/article_1i/article_1370292031.shtml` 中的 `1370292031`）
- `title`: 新闻标题（如："黄山歙县："路面管控+源头排查" 把好大型车辆冬季安全关"）
- `source_url`: 原文完整URL

#### 内容字段
- `content`: 保留HTML标签的正文内容（用于展示）
- `content_text`: 纯文本内容（用于全文搜索和分析）
- `summary`: 文章摘要/导语（如果页面提供）

#### 元数据
- `author`: 作者（如："余胜理"）
- `source_name`: 来源媒体（如："市场星报"）
- `region`: 地区标签（如："黄山"）
- `category`: 分类路径（如："正文 > 新闻 > 黄山"）
- `tags`: 标签数组（如：['黄山', '交通', '安全']）
- `publish_time`: 发布时间（如：2025-12-24 19:49:52）

#### 统计数据
- `view_count`: 浏览次数（如果页面提供）
- `share_count`: 分享次数（如果页面提供）

#### 多媒体与关联数据（JSONB格式）

**images** - 图片数组
```json
[
  {"url": "http://...", "caption": "图片说明", "order": 1},
  {"url": "http://...", "caption": "", "order": 2}
]
```

**qr_codes** - 二维码信息
```json
[
  {"type": "app", "url": "http://...", "description": "安徽财经网APP"},
  {"type": "wechat", "url": "http://...", "description": "市场星报公众号"}
]
```

**contact_info** - 联系方式
```json
{
  "hotline": "0551-62620110",
  "complaint": "0551-64376913",
  "email": "315reports@qq.com"
}
```

**related_links** - 相关链接
```json
[
  {"title": "相关新闻标题", "url": "http://..."},
  {"title": "推荐阅读", "url": "http://..."}
]
```

#### 爬取管理
- `crawl_time`: 实际爬取时间
- `status`: 爬取状态（pending/crawled/failed）
- `error_message`: 错误信息（记录失败原因）
- `raw_html`: 原始HTML（可选，用于调试和重新解析）

---

## 状态枚举说明

### news.status
| 值 | 说明 |
|---|------|
| pending | 待爬取详情 |
| crawled | 已爬取完成 |
| failed | 爬取失败 |

### crawl_tasks.status
| 值 | 说明 |
|---|------|
| pending | 待执行 |
| running | 执行中 |
| completed | 已完成 |
| failed | 失败 |

### crawl_sessions.status
| 值 | 说明 |
|---|------|
| running | 运行中 |
| paused | 已暂停 |
| completed | 已完成 |

---

## ER 关系图

```
┌─────────────────┐     ┌─────────────────┐
│  crawl_sessions │     │  login_sessions │
│─────────────────│     │─────────────────│
│  id             │     │  id             │
│  session_name   │     │  cookies        │
│  total_pages    │     │  is_valid       │
│  current_page   │     │  expires_at     │
│  status         │     └─────────────────┘
└────────┬────────┘
         │
         │ 1:N
         ▼
┌─────────────────┐     ┌─────────────────┐
│      news       │◄────│   crawl_tasks   │
│─────────────────│     │─────────────────│
│  id             │     │  id             │
│  source_id (UK) │     │  task_type      │
│  title          │     │  target_url     │
│  content        │     │  news_source_id │
│  region         │     │  status         │
│  publish_time   │     │  retry_count    │
│  status         │     └─────────────────┘
└─────────────────┘
```
