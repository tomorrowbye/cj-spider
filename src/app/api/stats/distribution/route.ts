import { NextResponse } from 'next/server';
import { getSupabaseClient } from '@/lib/supabase';

export async function GET() {
  try {
    const supabase = getSupabaseClient();

    // 获取所有新闻数据用于统计
    const { data: newsData, error } = await supabase
      .from('news')
      .select('region, source_name, author')
      .eq('status', 'crawled');

    if (error) {
      throw error;
    }

    // 统计地区分布
    const regionMap = new Map<string, number>();
    // 统计来源分布
    const sourceMap = new Map<string, number>();
    // 统计作者分布
    const authorMap = new Map<string, number>();

    newsData?.forEach((item) => {
      // 地区统计
      const region = item.region || '未知';
      regionMap.set(region, (regionMap.get(region) || 0) + 1);

      // 来源统计
      const source = item.source_name || '未知';
      sourceMap.set(source, (sourceMap.get(source) || 0) + 1);

      // 作者统计
      const author = item.author || '未知';
      authorMap.set(author, (authorMap.get(author) || 0) + 1);
    });

    // 转换为数组并排序
    const regions = Array.from(regionMap.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    const sources = Array.from(sourceMap.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10); // Top 10

    const authors = Array.from(authorMap.entries())
      .map(([name, count]) => ({ name, count }))
      .filter((item) => item.name !== '未知') // 过滤未知作者
      .sort((a, b) => b.count - a.count)
      .slice(0, 10); // Top 10

    return NextResponse.json({
      success: true,
      data: {
        regions,
        sources,
        authors,
      },
    });
  } catch (error) {
    console.error('获取分布数据失败:', error);
    return NextResponse.json(
      { success: false, error: '获取分布数据失败' },
      { status: 500 }
    );
  }
}
