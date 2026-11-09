import { requireSiteAuth } from "@/lib/auth-gate";
import { NextRequest, NextResponse } from "next/server";
import { getNewsList, getFilterOptions, parseNewsListParams, InvalidNewsListParams } from "@/lib/news-service";

export async function GET(request: NextRequest) {
  const authError = await requireSiteAuth();
  if (authError) return authError;
  try {
    const { searchParams } = new URL(request.url);

    const params = parseNewsListParams(searchParams);

    const result = await getNewsList(params);

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error) {
    if (error instanceof InvalidNewsListParams) {
      return NextResponse.json({ success: false, error: error.message }, { status: 400 });
    }
    console.error("获取新闻列表失败:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "获取列表失败",
      },
      { status: 500 },
    );
  }
}

// 获取筛选选项
export async function POST(request: NextRequest) {
  const authError = await requireSiteAuth();
  if (authError) return authError;
  try {
    const body = await request.json();

    if (body.action === "getFilterOptions") {
      const options = await getFilterOptions();
      return NextResponse.json({
        success: true,
        data: options,
      });
    }

    return NextResponse.json(
      { success: false, error: "未知操作" },
      { status: 400 },
    );
  } catch (error) {
    console.error("操作失败:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "操作失败",
      },
      { status: 500 },
    );
  }
}
