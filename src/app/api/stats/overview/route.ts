import { requireSiteAuth } from '@/lib/auth-gate';
import { NextResponse } from 'next/server';
import { getOverview } from '@/lib/stats-service';

export async function GET() {
  const authError = await requireSiteAuth();
  if (authError) return authError;
  try {
    return NextResponse.json({ success: true, data: await getOverview() });
  } catch (error) {
    console.error('获取概览统计失败:', error);
    return NextResponse.json({ success: false, error: '获取统计数据失败' }, { status: 500 });
  }
}
