import { requireSiteAuth } from '@/lib/auth-gate';
import { NextRequest, NextResponse } from 'next/server';
import { getTrend } from '@/lib/stats-service';

export async function GET(request: NextRequest) {
  const authError = await requireSiteAuth();
  if (authError) return authError;
  try {
    const days = parseInt(new URL(request.url).searchParams.get('days') || '30');
    return NextResponse.json({ success: true, data: await getTrend(days) });
  } catch (error) {
    console.error('获取趋势数据失败:', error);
    return NextResponse.json({ success: false, error: '获取趋势数据失败' }, { status: 500 });
  }
}
