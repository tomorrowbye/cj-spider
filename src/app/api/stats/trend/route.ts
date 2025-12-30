import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const days = parseInt(searchParams.get("days") || "30");

    const supabase = getSupabaseClient();

    // 使用数据库函数进行聚合统计，避免 1000 条限制
    const [crawlResult, publishResult] = await Promise.all([
      supabase.rpc("get_crawl_trend", { days_count: days }),
      supabase.rpc("get_publish_trend", { days_count: days }),
    ]);

    if (crawlResult.error) {
      console.error("获取爬取趋势失败:", crawlResult.error);
      throw crawlResult.error;
    }

    if (publishResult.error) {
      console.error("获取发布趋势失败:", publishResult.error);
      throw publishResult.error;
    }

    // 初始化日期范围，确保所有日期都有数据点
    const crawlTrendMap = new Map<string, number>();
    for (let i = 0; i < days; i++) {
      const date = new Date();
      date.setDate(date.getDate() - (days - 1 - i));
      // 使用东8区日期
      const beijingDate = new Date(date.getTime() + 8 * 60 * 60 * 1000);
      const dateStr = beijingDate.toISOString().split("T")[0];
      crawlTrendMap.set(dateStr, 0);
    }

    // 填充数据库返回的统计数据
    crawlResult.data?.forEach((item: { date: string; count: number }) => {
      if (crawlTrendMap.has(item.date)) {
        crawlTrendMap.set(item.date, item.count);
      }
    });

    const crawlTrend = Array.from(crawlTrendMap.entries())
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const publishTrend = (
      (publishResult.data as { month: string; count: number }[]) || []
    )
      .map((item) => ({ month: item.month, count: item.count }))
      .sort((a, b) => a.month.localeCompare(b.month));

    return NextResponse.json({
      success: true,
      data: {
        crawlTrend,
        publishTrend,
      },
    });
  } catch (error) {
    console.error("获取趋势数据失败:", error);
    return NextResponse.json(
      { success: false, error: "获取趋势数据失败" },
      { status: 500 },
    );
  }
}
