import { NextResponse } from 'next/server';
import { getNewsStats } from '@/lib/supabase';

export async function GET() {
  try {
    const stats = await getNewsStats();

    return NextResponse.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error('获取统计数据失败:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : '获取统计数据失败'
      },
      { status: 500 }
    );
  }
}
