import { requireSiteAuth } from '@/lib/auth-gate';
import { NextRequest, NextResponse } from 'next/server';
import { buildNewsWorkbook, DEFAULT_NEWS_COLUMNS, NEWS_COLUMN_DEFINITIONS, ExportError, recordNewsExport } from '@/lib/export-service';

export async function POST(request: NextRequest) {
  const authError = await requireSiteAuth();
  if (authError) return authError;
  try {
    const { columns = DEFAULT_NEWS_COLUMNS, ...params } = await request.json();
    const result = await buildNewsWorkbook(params, columns);
    try {
      await recordNewsExport(params, columns, result);
    } catch (historyError) {
      // History persistence is best-effort; a successful download must still succeed.
      console.error('记录导出历史失败:', historyError);
    }
    return new NextResponse(new Uint8Array(result.buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${result.filename}"`,
      },
    });
  } catch (error) {
    if (!(error instanceof ExportError)) console.error('导出失败:', error);
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : '导出失败' }, { status: error instanceof ExportError ? 400 : 500 });
  }
}

export async function GET() {
  const authError = await requireSiteAuth();
  if (authError) return authError;
  return NextResponse.json({ success: true, columns: Object.entries(NEWS_COLUMN_DEFINITIONS).map(([key, value]) => ({ key, label: value.header })) });
}
