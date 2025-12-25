import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/lib/supabase';

// 获取导出历史记录
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = parseInt(searchParams.get('pageSize') || '10');

    const supabase = getSupabaseClient();

    // 分页查询
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    const { data, count, error } = await supabase
      .from('export_history')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
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
    console.error('获取导出历史失败:', error);
    return NextResponse.json(
      { success: false, error: '获取导出历史失败' },
      { status: 500 }
    );
  }
}

// 删除导出历史记录
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { success: false, error: '请提供记录ID' },
        { status: 400 }
      );
    }

    const supabase = getSupabaseClient();

    const { error } = await supabase
      .from('export_history')
      .delete()
      .eq('id', id);

    if (error) {
      throw error;
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('删除导出历史失败:', error);
    return NextResponse.json(
      { success: false, error: '删除失败' },
      { status: 500 }
    );
  }
}
