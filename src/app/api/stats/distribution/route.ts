import { requireSiteAuth } from '@/lib/auth-gate';
import { NextResponse } from 'next/server';
import { getDistribution } from '@/lib/stats-service';

export async function GET() {
  const authError = await requireSiteAuth();
  if (authError) return authError;
  try {
    return NextResponse.json({ success: true, data: await getDistribution() });
  } catch (error) {
    console.error('获取分布数据失败:', error);
    return NextResponse.json({ success: false, error: '获取分布数据失败' }, { status: 500 });
  }
}
