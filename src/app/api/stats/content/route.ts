import { NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";

export async function GET() {
  try {
    const supabase = getSupabaseClient();

    // 使用数据库函数进行聚合统计，避免 1000 条限制
    const [lengthResult, imageResult, tagsResult] = await Promise.all([
      supabase.rpc("get_length_distribution"),
      supabase.rpc("get_image_stats"),
      supabase.rpc("get_tag_distribution", { limit_count: 20 }),
    ]);

    if (lengthResult.error) {
      console.error("获取长度分布失败:", lengthResult.error);
      throw lengthResult.error;
    }

    if (imageResult.error) {
      console.error("获取图片统计失败:", imageResult.error);
      throw imageResult.error;
    }

    if (tagsResult.error) {
      console.error("获取标签统计失败:", tagsResult.error);
      throw tagsResult.error;
    }

    const imageStats = imageResult.data?.[0] || {
      with_images: 0,
      without_images: 0,
    };

    return NextResponse.json({
      success: true,
      data: {
        lengthDistribution: lengthResult.data || [],
        withImages: imageStats.with_images || 0,
        withoutImages: imageStats.without_images || 0,
        topTags: tagsResult.data || [],
      },
    });
  } catch (error) {
    console.error("获取内容分析数据失败:", error);
    return NextResponse.json(
      { success: false, error: "获取内容分析数据失败" },
      { status: 500 },
    );
  }
}
