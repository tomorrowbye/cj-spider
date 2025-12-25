import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/lib/supabase';
import * as XLSX from 'xlsx';

// GET 返回可导出的列
export async function GET() {
  const columns = [
    { key: 'id', label: 'ID' },
    { key: 'session_name', label: '任务名称' },
    { key: 'total_pages', label: '总页数' },
    { key: 'current_page', label: '当前页码' },
    { key: 'total_news', label: '发现文章数' },
    { key: 'crawled_news', label: '已爬取数' },
    { key: 'status', label: '状态' },
    { key: 'started_at', label: '开始时间' },
    { key: 'finished_at', label: '完成时间' },
    { key: 'duration', label: '耗时(分钟)' },
    { key: 'success_rate', label: '成功率' },
  ];

  return NextResponse.json({ success: true, columns });
}

// POST 执行导出
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { columns = ['id', 'session_name', 'status', 'started_at'], status } = body;

    const supabase = getSupabaseClient();

    // 构建查询
    let query = supabase.from('crawl_sessions').select('*');

    if (status && status !== 'all') {
      query = query.eq('status', status);
    }

    const { data, error } = await query.order('started_at', { ascending: false });

    if (error) {
      throw error;
    }

    if (!data || data.length === 0) {
      return NextResponse.json(
        { success: false, error: '没有数据可导出' },
        { status: 400 }
      );
    }

    // 列名映射
    const columnLabels: Record<string, string> = {
      id: 'ID',
      session_name: '任务名称',
      total_pages: '总页数',
      current_page: '当前页码',
      total_news: '发现文章数',
      crawled_news: '已爬取数',
      status: '状态',
      started_at: '开始时间',
      finished_at: '完成时间',
      duration: '耗时(分钟)',
      success_rate: '成功率',
    };

    // 状态映射
    const statusLabels: Record<string, string> = {
      running: '运行中',
      paused: '已暂停',
      completed: '已完成',
      failed: '失败',
    };

    // 处理数据
    const exportData = data.map((item) => {
      const row: Record<string, unknown> = {};

      columns.forEach((col: string) => {
        const label = columnLabels[col] || col;

        switch (col) {
          case 'status':
            row[label] = statusLabels[item.status] || item.status;
            break;
          case 'started_at':
          case 'finished_at':
            row[label] = item[col]
              ? new Date(item[col]).toLocaleString('zh-CN')
              : '-';
            break;
          case 'duration':
            if (item.started_at && item.finished_at) {
              const start = new Date(item.started_at).getTime();
              const end = new Date(item.finished_at).getTime();
              const minutes = Math.round((end - start) / 60000 * 10) / 10;
              row[label] = minutes;
            } else if (item.started_at && item.status === 'running') {
              const start = new Date(item.started_at).getTime();
              const now = Date.now();
              const minutes = Math.round((now - start) / 60000 * 10) / 10;
              row[label] = `${minutes} (进行中)`;
            } else {
              row[label] = '-';
            }
            break;
          case 'success_rate':
            if (item.total_news && item.total_news > 0) {
              const rate = Math.round((item.crawled_news / item.total_news) * 1000) / 10;
              row[label] = `${rate}%`;
            } else {
              row[label] = '-';
            }
            break;
          default:
            row[label] = item[col] ?? '-';
        }
      });

      return row;
    });

    // 创建工作簿
    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, '爬取历史');

    // 设置列宽
    const colWidths = columns.map((col: string) => {
      switch (col) {
        case 'session_name':
          return { wch: 20 };
        case 'started_at':
        case 'finished_at':
          return { wch: 20 };
        default:
          return { wch: 12 };
      }
    });
    worksheet['!cols'] = colWidths;

    // 导出为 buffer
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename=crawl_history_${new Date().toISOString().slice(0, 10)}.xlsx`,
      },
    });
  } catch (error) {
    console.error('导出历史记录失败:', error);
    return NextResponse.json(
      { success: false, error: '导出失败' },
      { status: 500 }
    );
  }
}
