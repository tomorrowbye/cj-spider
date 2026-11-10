import { requireSiteAuth } from '@/lib/auth-gate';
import { NextRequest, NextResponse } from 'next/server';
import { buildCrawlHistoryWorkbook, DEFAULT_CRAWL_HISTORY_COLUMNS, CRAWL_HISTORY_COLUMN_DEFINITIONS, ExportError } from '@/lib/export-service';

export async function GET() {
  const authError = await requireSiteAuth();
  if (authError) return authError;
  return NextResponse.json({ success: true, columns: Object.entries(CRAWL_HISTORY_COLUMN_DEFINITIONS).map(([key, value]) => ({ key, label: value.header })) });
}

export async function POST(request: NextRequest) {
  const authError = await requireSiteAuth();
  if (authError) return authError;
  try {
    const { columns = DEFAULT_CRAWL_HISTORY_COLUMNS, status } = await request.json();
    const result = await buildCrawlHistoryWorkbook({ status }, columns);
    return new NextResponse(new Uint8Array(result.buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename=${result.filename}`,
      },
    });
  } catch (error) {
    if (!(error instanceof ExportError)) console.error('导出历史记录失败:', error);
    return NextResponse.json({ success: false, error: error instanceof ExportError ? error.message : '导出失败' }, { status: error instanceof ExportError ? 400 : 500 });
  }
}
