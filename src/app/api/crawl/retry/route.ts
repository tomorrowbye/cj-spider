import { NextRequest, NextResponse } from "next/server";
import { retryFailedArticles } from "@/lib/crawl/task-manager";
import { checkLoginStatus } from "@/lib/cj-auth";
import { getCjCookies } from "@/lib/auth-helper";

export async function POST(request: NextRequest) {
  try {
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

    const result = await retryFailedArticles(cookie);

    return NextResponse.json({
      success: true,
      data: result,
      message: `已重置 ${result.count} 篇失败文章为待爬取状态`,
    });
  } catch (error) {
    console.error("重试失败文章失败:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "重试失败",
      },
      { status: 500 },
    );
  }
}
