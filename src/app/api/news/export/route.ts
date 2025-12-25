import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getNewsForExport } from "@/lib/news-service";
import { getSupabaseClient } from "@/lib/supabase";

// 可导出的列定义
const COLUMN_DEFINITIONS = {
  source_id: { header: "文章ID", width: 15 },
  title: { header: "标题", width: 50 },
  author: { header: "作者", width: 15 },
  source_name: { header: "来源", width: 20 },
  region: { header: "地区", width: 15 },
  publish_time: { header: "发布时间", width: 20 },
  status: { header: "状态", width: 10 },
  content_text: { header: "内容", width: 100 },
  created_at: { header: "爬取时间", width: 20 },
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      columns = [
        "source_id",
        "title",
        "author",
        "source_name",
        "region",
        "publish_time",
      ],
      keyword,
      author,
      region,
      sourceName,
      startDate,
      endDate,
      ...otherParams
    } = body;

    const searchParams = {
      keyword,
      author,
      region,
      sourceName,
      startDate,
      endDate,
      ...otherParams,
    };

    // 获取数据
    const data = await getNewsForExport(searchParams);

    if (data.length === 0) {
      return NextResponse.json(
        { success: false, error: "没有可导出的数据" },
        { status: 400 },
      );
    }

    // 构建导出数据
    const exportData = data.map((item) => {
      const row: Record<string, unknown> = {};
      columns.forEach((col: string) => {
        const def = COLUMN_DEFINITIONS[col as keyof typeof COLUMN_DEFINITIONS];
        if (def) {
          let value = item[col as keyof typeof item];
          // 格式化时间
          if ((col === "publish_time" || col === "created_at") && value) {
            value = new Date(value as string).toLocaleString("zh-CN");
          }
          // 状态转换
          if (col === "status") {
            value =
              value === "crawled"
                ? "已爬取"
                : value === "pending"
                  ? "待爬取"
                  : "失败";
          }
          row[def.header] = value || "";
        }
      });
      return row;
    });

    // 创建工作簿
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(exportData);

    // 设置列宽
    const colWidths = columns.map((col: string) => ({
      wch:
        COLUMN_DEFINITIONS[col as keyof typeof COLUMN_DEFINITIONS]?.width || 15,
    }));
    ws["!cols"] = colWidths;

    XLSX.utils.book_append_sheet(wb, ws, "新闻列表");

    // 生成 buffer
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    // 生成文件名
    const filename = `news_export_${new Date().toISOString().slice(0, 10)}.xlsx`;

    // 记录导出历史
    try {
      const supabase = getSupabaseClient();
      await supabase.from("export_history").insert({
        keyword: keyword || null,
        author: author || null,
        region: region || null,
        source_name: sourceName || null,
        start_date: startDate || null,
        end_date: endDate || null,
        total_count: data.length,
        columns: columns,
        file_name: filename,
      });
    } catch (historyError) {
      // 记录历史失败不影响导出
      console.error("记录导出历史失败:", historyError);
    }

    // 返回文件
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error("导出失败:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "导出失败",
      },
      { status: 500 },
    );
  }
}

// 获取可导出的列
export async function GET() {
  return NextResponse.json({
    success: true,
    columns: Object.entries(COLUMN_DEFINITIONS).map(([key, value]) => ({
      key,
      label: value.header,
    })),
  });
}
