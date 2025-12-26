-- 修复 Supabase 数据库时区问题
-- 问题：数据库 created_at 字段存储的是东8区时间，而非 UTC 时间
-- 解决：确保数据库使用 UTC 时区，并修改默认值

-- 1. 检查当前时区设置
SHOW timezone;

-- 2. 设置数据库时区为 UTC（如果不是的话）
-- ALTER DATABASE postgres SET timezone TO 'UTC';

-- 3. 修改 export_history 表的 created_at 默认值
-- 确保使用 UTC 时间而不是本地时间
ALTER TABLE export_history
ALTER COLUMN created_at SET DEFAULT (NOW() AT TIME ZONE 'UTC');

-- 4. 修改 crawl_sessions 表的时间字段默认值
ALTER TABLE crawl_sessions
ALTER COLUMN started_at SET DEFAULT (NOW() AT TIME ZONE 'UTC');

ALTER TABLE crawl_sessions
ALTER COLUMN finished_at SET DEFAULT NULL;

-- 5. 修改 users 表的时间字段默认值
ALTER TABLE users
ALTER COLUMN created_at SET DEFAULT (NOW() AT TIME ZONE 'UTC');

ALTER TABLE users
ALTER COLUMN updated_at SET DEFAULT (NOW() AT TIME ZONE 'UTC');

-- 6. 修改 news 表的时间字段默认值
ALTER TABLE news
ALTER COLUMN created_at SET DEFAULT (NOW() AT TIME ZONE 'UTC');

ALTER TABLE news
ALTER COLUMN updated_at SET DEFAULT (NOW() AT TIME ZONE 'UTC');

-- 验证修改
SELECT
  table_name,
  column_name,
  column_default,
  data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND column_name IN ('created_at', 'updated_at', 'started_at', 'finished_at')
ORDER BY table_name, column_name;

-- 注意事项：
-- 1. 执行此脚本后，新插入的记录将使用 UTC 时间
-- 2. 已存在的记录时间不会自动修正，需要手动更新
-- 3. 如果需要修正已存在的数据，参考下面的更新语句

-- 可选：修正已存在的数据（如果当前数据是东8区时间）
-- 警告：只在确认数据是东8区时间时执行此操作

-- UPDATE export_history
-- SET created_at = created_at - INTERVAL '8 hours'
-- WHERE created_at > '2025-01-01';  -- 根据实际情况调整时间范围

-- UPDATE crawl_sessions
-- SET started_at = started_at - INTERVAL '8 hours',
--     finished_at = CASE WHEN finished_at IS NOT NULL THEN finished_at - INTERVAL '8 hours' ELSE NULL END
-- WHERE started_at > '2025-01-01';

-- UPDATE users
-- SET created_at = created_at - INTERVAL '8 hours',
--     updated_at = updated_at - INTERVAL '8 hours'
-- WHERE created_at > '2025-01-01';

-- UPDATE news
-- SET created_at = created_at - INTERVAL '8 hours',
--     updated_at = updated_at - INTERVAL '8 hours'
-- WHERE created_at > '2025-01-01';
