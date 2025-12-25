import { NextRequest, NextResponse } from "next/server";
import { getNewsList, getFilterOptions } from "@/lib/news-service";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    // 解析查询参数
    const params = {
      author: searchParams.get("author") || undefined,
      region: searchParams.get("region") || undefined,
      sourceName: searchParams.get("sourceName") || undefined,
      category: searchParams.get("category") || undefined,
      startDate: searchParams.get("startDate") || undefined,
      endDate: searchParams.get("endDate") || undefined,
      status: searchParams.get("status") || undefined,
      keyword: searchParams.get("keyword") || undefined,
      title: searchParams.get("title") || undefined,
      page: parseInt(searchParams.get("page") || "1", 10),
      pageSize: parseInt(searchParams.get("pageSize") || "20", 10),
      orderBy: searchParams.get("orderBy") || "source_id",
      order: (searchParams.get("order") || "desc") as "asc" | "desc",
    };

    const result = await getNewsList(params);

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error) {
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
