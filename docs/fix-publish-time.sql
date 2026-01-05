-- 修复新闻文章发布时间(publish_time)的时区问题
--
-- 问题描述:
--   新闻网站显示的时间是北京时间(UTC+8),例如: 2026-01-04 10:00:05
--   但爬虫在解析时没有指定时区,导致存储到数据库时多加了8小时
--   数据库中存储为: 2026-01-04 18:00:05 (UTC)
--   显示时转回北京时间: 2026-01-04 18:00:05 + 8小时 = 显示错误
--
-- 解决方案:
--   将所有已爬取的文章的 publish_time 减去8小时,恢复为正确的UTC时间
--
-- 使用方法:
--   1. 先备份数据(可选但推荐)
--   2. 执行本脚本修正 publish_time 字段
--   3. 验证修正结果
--
-- 注意: 代码已修复(src/lib/supabase.ts),新爬取的文章时间将正确

-- ============================================
-- 第一步: 备份数据(可选但强烈推荐)
-- ============================================

-- 创建备份表(如果还没有)
-- CREATE TABLE news_backup_20260105 AS SELECT * FROM news;

-- ============================================
-- 第二步: 检查当前数据
-- ============================================

-- 查看受影响的记录数量
SELECT COUNT(*) as total_records_with_publish_time
FROM news
WHERE publish_time IS NOT NULL;

-- 查看几条示例数据(修正前)
SELECT
  id,
  title,
  publish_time,
  publish_time AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Shanghai' as beijing_time_display,
  status,
  created_at
FROM news
WHERE publish_time IS NOT NULL
ORDER BY publish_time DESC
LIMIT 5;

-- ============================================
-- 第三步: 修正 publish_time (减去8小时)
-- ============================================

-- 更新所有有发布时间的记录
-- 将 publish_time 减去 8 小时,修正为正确的 UTC 时间
UPDATE news
SET publish_time = publish_time - INTERVAL '8 hours'
WHERE publish_time IS NOT NULL;

-- ============================================
-- 第四步: 验证修正结果
-- ============================================

-- 查看修正后的数据
SELECT
  id,
  title,
  publish_time as utc_time,
  publish_time AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Shanghai' as beijing_time_display,
  status,
  updated_at
FROM news
WHERE publish_time IS NOT NULL
ORDER BY publish_time DESC
LIMIT 10;

-- 统计各状态的记录数
SELECT
  status,
  COUNT(*) as count,
  COUNT(publish_time) as has_publish_time
FROM news
GROUP BY status
ORDER BY status;

-- ============================================
-- 验证说明
-- ============================================
--
-- 验证方法:
--   1. beijing_time_display 列应该显示为北京时间
--   2. 对比新闻网站上的原始发布时间
--   3. 确认时间匹配后,说明修正成功
--
-- 例如:
--   网站显示: 2026-01-04 10:00:05
--   修正后 publish_time (UTC): 2026-01-04 02:00:05
--   beijing_time_display: 2026-01-04 10:00:05 ✓ 正确
