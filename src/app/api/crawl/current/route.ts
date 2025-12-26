import { NextResponse } from 'next/server';
import { getCurrentRunningTask } from '@/lib/crawl/task-manager';

export async function GET() {
  try {
    const currentTask = await getCurrentRunningTask();

    return NextResponse.json({
      success: true,
      data: currentTask,
    });
  } catch (error) {
    console.error('获取当前任务失败:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : '获取当前任务失败'
      },
      { status: 500 }
    );
  }
}
