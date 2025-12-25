import { NextRequest, NextResponse } from 'next/server';
import { getCrawlTaskStatus } from '@/lib/crawl/task-manager';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get('sessionId');

    if (!sessionId) {
      return NextResponse.json(
        { success: false, error: '请提供 sessionId' },
        { status: 400 }
      );
    }

    const status = await getCrawlTaskStatus(sessionId);

    if (!status) {
      return NextResponse.json(
        { success: false, error: '任务不存在' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: status,
    });
  } catch (error) {
    console.error('获取任务状态失败:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : '获取任务状态失败'
      },
      { status: 500 }
    );
  }
}
