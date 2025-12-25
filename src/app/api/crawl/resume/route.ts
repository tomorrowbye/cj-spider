import { NextRequest, NextResponse } from "next/server";
import { resumeCrawlTask } from "@/lib/crawl/task-manager";
import { checkLoginStatus } from "@/lib/cj-auth";
import { getCjCookies } from "@/lib/auth-helper";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { sessionId } = body;

    if (!sessionId) {
      return NextResponse.json(
        { success: false, error: "请提供 sessionId" },
        { status: 400 },
      );
    }

    // 获取原站 cookie
    const cookie = getCjCookies(request);

    if (!cookie) {
      return NextResponse.json(
        { success: false, error: "请先登录" },
        { status: 401 },
      );
    }

    // 验证登录状态
    const isLoggedIn = await checkLoginStatus(cookie);
    if (!isLoggedIn) {
      return NextResponse.json(
        { success: false, error: "登录已过期，请重新登录" },
        { status: 401 },
      );
    }

    const success = await resumeCrawlTask(sessionId, cookie);

    if (!success) {
      return NextResponse.json(
        { success: false, error: "任务不存在或无法继续" },
        { status: 400 },
      );
    }

    return NextResponse.json({
      success: true,
      message: "任务已继续",
    });
  } catch (error) {
    console.error("继续任务失败:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "继续任务失败",
      },
      { status: 500 },
    );
  }
}
