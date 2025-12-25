import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const days = parseInt(searchParams.get('days') || '30');

    const supabase = getSupabaseClient();

    // 获取最近 N 天的爬取趋势
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);

    const { data: newsData, error } = await supabase
      .from('news')
      .select('created_at, publish_time')
      .gte('created_at', startDate.toISOString())
      .order('created_at', { ascending: true });

    if (error) {
      throw error;
    }

    // 按天聚合爬取数据
    const crawlTrendMap = new Map<string, number>();
    const publishTrendMap = new Map<string, number>();

    // 初始化日期范围
    for (let i = 0; i < days; i++) {
      const date = new Date();
      date.setDate(date.getDate() - (days - 1 - i));
      const dateStr = date.toISOString().split('T')[0];
      crawlTrendMap.set(dateStr, 0);
    }

    // 统计爬取趋势
    newsData?.forEach((item) => {
      if (item.created_at) {
        const dateStr = new Date(item.created_at).toISOString().split('T')[0];
        if (crawlTrendMap.has(dateStr)) {
          crawlTrendMap.set(dateStr, (crawlTrendMap.get(dateStr) || 0) + 1);
        }
      }

      // 统计发布时间分布（按月）
      if (item.publish_time) {
        const monthStr = new Date(item.publish_time).toISOString().slice(0, 7);
        publishTrendMap.set(monthStr, (publishTrendMap.get(monthStr) || 0) + 1);
      }
    });

    const crawlTrend = Array.from(crawlTrendMap.entries())
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const publishTrend = Array.from(publishTrendMap.entries())
      .map(([month, count]) => ({ month, count }))
      .sort((a, b) => a.month.localeCompare(b.month));

    return NextResponse.json({
      success: true,
      data: {
        crawlTrend,
        publishTrend,
      },
    });
  } catch (error) {
    console.error('获取趋势数据失败:', error);
    return NextResponse.json(
      { success: false, error: '获取趋势数据失败' },
      { status: 500 }
    );
  }
}
