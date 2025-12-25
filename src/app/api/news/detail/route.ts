import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { success: false, error: '请提供新闻ID' },
        { status: 400 }
      );
    }

    const supabase = getSupabaseClient();

    const { data, error } = await supabase
      .from('news')
      .select('*')
      .eq('source_id', id)
      .single();

    if (error) {
      console.error('查询新闻详情失败:', error);
      return NextResponse.json(
        { success: false, error: '新闻不存在' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data,
    });
  } catch (error) {
    console.error('获取新闻详情失败:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : '获取详情失败'
      },
      { status: 500 }
    );
  }
}
