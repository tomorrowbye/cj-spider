-- 创建趋势统计函数
-- 解决 Supabase 默认 1000 条查询限制问题
-- 通过数据库层面聚合统计，避免获取全部数据

-- 创建爬取趋势统计函数
CREATE OR REPLACE FUNCTION get_crawl_trend(days_count INTEGER DEFAULT 30)
RETURNS TABLE (
  date TEXT,
  count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    TO_CHAR((created_at + INTERVAL '8 hours')::DATE, 'YYYY-MM-DD') AS date,
    COUNT(*)::BIGINT AS count
  FROM news
  WHERE status = 'crawled'
    AND created_at >= (NOW() - (days_count || ' days')::INTERVAL)
  GROUP BY TO_CHAR((created_at + INTERVAL '8 hours')::DATE, 'YYYY-MM-DD')
  ORDER BY date;
END;
$$ LANGUAGE plpgsql;

-- 创建发布趋势统计函数（按月）
CREATE OR REPLACE FUNCTION get_publish_trend(days_count INTEGER DEFAULT 30)
RETURNS TABLE (
  month TEXT,
  count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    TO_CHAR(publish_time::DATE, 'YYYY-MM') AS month,
    COUNT(*)::BIGINT AS count
  FROM news
  WHERE status = 'crawled'
    AND publish_time IS NOT NULL
    AND created_at >= (NOW() - (days_count || ' days')::INTERVAL)
  GROUP BY TO_CHAR(publish_time::DATE, 'YYYY-MM')
  ORDER BY month;
END;
$$ LANGUAGE plpgsql;

-- 验证函数
-- SELECT * FROM get_crawl_trend(30);
-- SELECT * FROM get_publish_trend(30);
