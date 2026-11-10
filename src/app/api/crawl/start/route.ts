import { requireSiteAuth } from '@/lib/auth-gate';
import { NextRequest, NextResponse } from 'next/server';
import { startCrawlTask } from '@/lib/crawl/task-manager';
import { getCjCookies } from '@/lib/auth-helper';
import { checkLoginStatus } from '@/lib/cj-auth';

export async function POST(request: NextRequest) {
  const authError = await requireSiteAuth();
  if (authError) return authError;
  try {
    const { startPage, endPage, skipExisting = true } = await request.json();
    if (!Number.isInteger(startPage) || !Number.isInteger(endPage) || startPage < 1 || endPage < startPage) {
      return NextResponse.json({ success: false, error: '无效的页码范围' }, { status: 400 });
    }
    const cookie = getCjCookies(request);
    if (!cookie) {
      return NextResponse.json({ success: false, error: '请先登录' }, { status: 401 });
    }
    if (!await checkLoginStatus(cookie)) {
      return NextResponse.json({ success: false, error: '登录已过期，请重新登录' }, { status: 401 });
    }
    const progress = await startCrawlTask({ startPage, endPage, skipExisting, cookie });
    if (progress.already_running) {
      return NextResponse.json({ success: false, already_running: true, data: progress, error: '已有爬取任务' }, { status: 409 });
    }
    return NextResponse.json({ success: true, data: progress, message: progress.status === 'paused' ? '任务等待登录' : '爬取任务已启动' });
  } catch {
    return NextResponse.json({ success: false, error: '启动爬取任务失败' }, { status: 400 });
  }
}
