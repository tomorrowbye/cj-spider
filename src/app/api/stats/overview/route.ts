import { NextResponse } from 'next/server';
import { getSupabaseClient } from '@/lib/supabase';

export async function GET() {
  try {
    const supabase = getSupabaseClient();

    // 获取总数和各状态数量
    const { count: total } = await supabase
      .from('news')
      .select('*', { count: 'exact', head: true });

    const { count: crawled } = await supabase
      .from('news')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'crawled');

    const { count: pending } = await supabase
      .from('news')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending');

    const { count: failed } = await supabase
      .from('news')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'failed');

    // 今日新增
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const { count: todayCount } = await supabase
      .from('news')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', today.toISOString());

    // 本周新增
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    weekStart.setHours(0, 0, 0, 0);
    const { count: weekCount } = await supabase
      .from('news')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', weekStart.toISOString());

    // 计算成功率
    const totalProcessed = (crawled || 0) + (failed || 0);
    const successRate = totalProcessed > 0
      ? Math.round(((crawled || 0) / totalProcessed) * 1000) / 10
      : 100;

    return NextResponse.json({
      success: true,
      data: {
        total: total || 0,
        crawled: crawled || 0,
        pending: pending || 0,
        failed: failed || 0,
        todayCount: todayCount || 0,
        weekCount: weekCount || 0,
        successRate,
      },
    });
  } catch (error) {
    console.error('获取概览统计失败:', error);
    return NextResponse.json(
      { success: false, error: '获取统计数据失败' },
      { status: 500 }
    );
  }
}
