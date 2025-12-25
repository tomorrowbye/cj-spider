import { NextRequest, NextResponse } from 'next/server';
import { pauseCrawlTask } from '@/lib/crawl/task-manager';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { sessionId } = body;

    if (!sessionId) {
      return NextResponse.json(
        { success: false, error: '请提供 sessionId' },
        { status: 400 }
      );
    }

    const success = await pauseCrawlTask(sessionId);

    if (!success) {
      return NextResponse.json(
        { success: false, error: '任务不存在或无法暂停' },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      message: '任务已暂停',
    });
  } catch (error) {
    console.error('暂停任务失败:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : '暂停任务失败'
      },
      { status: 500 }
    );
  }
}
