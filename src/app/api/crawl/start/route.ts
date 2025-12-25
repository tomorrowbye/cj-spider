import { NextRequest, NextResponse } from "next/server";
import { startCrawlTask } from "@/lib/crawl/task-manager";
import { checkLoginStatus } from "@/lib/cj-auth";
import { getCjCookies } from "@/lib/auth-helper";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { startPage, endPage, skipExisting = true } = body;

    // 验证参数
    if (!startPage || !endPage) {
      return NextResponse.json(
        { success: false, error: "请指定起始页码和结束页码" },
        { status: 400 },
      );
    }

    if (startPage < 1 || endPage < startPage) {
      return NextResponse.json(
        { success: false, error: "无效的页码范围" },
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

    // 启动爬取任务
    const progress = await startCrawlTask({
      startPage,
      endPage,
      skipExisting,
      cookie,
    });

    return NextResponse.json({
      success: true,
      data: progress,
      message: "爬取任务已启动",
    });
  } catch (error) {
    console.error("启动爬取任务失败:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "启动爬取任务失败",
      },
      { status: 500 },
    );
  }
}
