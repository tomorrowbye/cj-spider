import { NextResponse } from 'next/server';
import { getSupabaseClient } from '@/lib/supabase';

export async function GET() {
  try {
    const supabase = getSupabaseClient();

    // 获取内容相关数据
    const { data: newsData, error } = await supabase
      .from('news')
      .select('content_text, images, tags')
      .eq('status', 'crawled');

    if (error) {
      throw error;
    }

    // 文章长度分布
    const lengthRanges = {
      '0-500': 0,
      '500-1000': 0,
      '1000-2000': 0,
      '2000-5000': 0,
      '5000+': 0,
    };

    // 图片统计
    let withImages = 0;
    let withoutImages = 0;

    // 标签统计
    const tagMap = new Map<string, number>();

    newsData?.forEach((item) => {
      // 文章长度
      const length = item.content_text?.length || 0;
      if (length < 500) {
        lengthRanges['0-500']++;
      } else if (length < 1000) {
        lengthRanges['500-1000']++;
      } else if (length < 2000) {
        lengthRanges['1000-2000']++;
      } else if (length < 5000) {
        lengthRanges['2000-5000']++;
      } else {
        lengthRanges['5000+']++;
      }

      // 图片统计
      if (item.images && Array.isArray(item.images) && item.images.length > 0) {
        withImages++;
      } else {
        withoutImages++;
      }

      // 标签统计
      if (item.tags && Array.isArray(item.tags)) {
        item.tags.forEach((tag: string) => {
          if (tag) {
            tagMap.set(tag, (tagMap.get(tag) || 0) + 1);
          }
        });
      }
    });

    const lengthDistribution = Object.entries(lengthRanges).map(([range, count]) => ({
      range,
      count,
    }));

    const topTags = Array.from(tagMap.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);

    return NextResponse.json({
      success: true,
      data: {
        lengthDistribution,
        withImages,
        withoutImages,
        topTags,
      },
    });
  } catch (error) {
    console.error('获取内容分析数据失败:', error);
    return NextResponse.json(
      { success: false, error: '获取内容分析数据失败' },
      { status: 500 }
    );
  }
}
