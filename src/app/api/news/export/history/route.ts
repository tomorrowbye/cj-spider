import { requireSiteAuth } from "@/lib/auth-gate";
import { NextRequest, NextResponse } from 'next/server';
import { listExportHistory, deleteExportHistory } from '@/lib/export-service';

// 获取导出历史记录
export async function GET(request: NextRequest) {
  const authError = await requireSiteAuth();
  if (authError) return authError;
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = parseInt(searchParams.get('pageSize') || '10');

    const { data, total: count } = await listExportHistory(page, pageSize);

    return NextResponse.json({
      success: true,
      data: data || [],
      total: count || 0,
      page,
      pageSize,
      totalPages: Math.ceil((count || 0) / pageSize),
    });
  } catch (error) {
    console.error('获取导出历史失败:', error);
    return NextResponse.json(
      { success: false, error: '获取导出历史失败' },
      { status: 500 }
    );
  }
}

// 删除导出历史记录
export async function DELETE(request: NextRequest) {
  const authError = await requireSiteAuth();
  if (authError) return authError;
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { success: false, error: '请提供记录ID' },
        { status: 400 }
      );
    }

    await deleteExportHistory(id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('删除导出历史失败:', error);
    return NextResponse.json(
      { success: false, error: '删除失败' },
      { status: 500 }
    );
  }
}
