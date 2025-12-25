import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = parseInt(searchParams.get('pageSize') || '10');
    const status = searchParams.get('status') || '';

    const supabase = getSupabaseClient();

    // 构建查询
    let query = supabase
      .from('crawl_sessions')
      .select('*', { count: 'exact' });

    // 状态筛选
    if (status && status !== 'all') {
      query = query.eq('status', status);
    }

    // 分页
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    const { data, count, error } = await query
      .order('started_at', { ascending: false })
      .range(from, to);

    if (error) {
      throw error;
    }

    return NextResponse.json({
      success: true,
      data: data || [],
      total: count || 0,
      page,
      pageSize,
      totalPages: Math.ceil((count || 0) / pageSize),
    });
  } catch (error) {
    console.error('获取爬取历史失败:', error);
    return NextResponse.json(
      { success: false, error: '获取历史记录失败' },
      { status: 500 }
    );
  }
}
