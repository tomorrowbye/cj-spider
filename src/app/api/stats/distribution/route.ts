import { NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";

export async function GET() {
  try {
    const supabase = getSupabaseClient();

    // 使用数据库函数进行聚合统计，避免 1000 条限制
    const [regionsResult, sourcesResult, authorsResult] = await Promise.all([
      supabase.rpc("get_region_distribution"),
      supabase.rpc("get_source_distribution", { limit_count: 10 }),
      supabase.rpc("get_author_distribution", { limit_count: 10 }),
    ]);

    if (regionsResult.error) {
      console.error("获取地区分布失败:", regionsResult.error);
      throw regionsResult.error;
    }

    if (sourcesResult.error) {
      console.error("获取来源分布失败:", sourcesResult.error);
      throw sourcesResult.error;
    }

    if (authorsResult.error) {
      console.error("获取作者分布失败:", authorsResult.error);
      throw authorsResult.error;
    }

    return NextResponse.json({
      success: true,
      data: {
        regions: regionsResult.data || [],
        sources: sourcesResult.data || [],
        authors: authorsResult.data || [],
      },
    });
  } catch (error) {
    console.error("获取分布数据失败:", error);
    return NextResponse.json(
      { success: false, error: "获取分布数据失败" },
      { status: 500 },
    );
  }
}
