import { requireSiteAuth } from "@/lib/auth-gate";
import { NextRequest, NextResponse } from 'next/server';
import { getArticle } from '@/lib/article-repository';

export async function GET(request: NextRequest) {
  const authError = await requireSiteAuth();
  if (authError) return authError;
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { success: false, error: '请提供新闻ID' },
        { status: 400 }
      );
    }

    const data = await getArticle(id);
    if (!data) {
      return NextResponse.json(
        { success: false, error: '新闻不存在' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data,
    });
  } catch (error) {
    console.error('获取新闻详情失败:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : '获取详情失败'
      },
      { status: 500 }
    );
  }
}
