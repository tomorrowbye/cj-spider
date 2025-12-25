"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DatePicker } from "@/components/ui/date-picker";
import {
  FileText,
  History,
  Trash2,
  CheckCircle2,
  Clock,
  XCircle,
  HelpCircle,
} from "lucide-react";

interface NewsItem {
  id: number;
  source_id: string;
  title: string;
  author: string | null;
  source_name: string | null;
  region: string | null;
  category: string | null;
  publish_time: string | null;
  status: string;
}

interface FilterOptions {
  authors: string[];
  regions: string[];
  sourceNames: string[];
  categories: string[];
}

interface ExportColumn {
  key: string;
  label: string;
}

interface ExportHistoryItem {
  id: number;
  keyword: string | null;
  author: string | null;
  region: string | null;
  source_name: string | null;
  start_date: string | null;
  end_date: string | null;
  total_count: number;
  columns: string[];
  file_name: string;
  created_at: string;
}

export default function NewsListPage() {
  const [news, setNews] = useState<NewsItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [totalPages, setTotalPages] = useState(0);

  // 搜索条件状态（用于输入）
  const [keyword, setKeyword] = useState("");
  const [author, setAuthor] = useState("");
  const [region, setRegion] = useState("");
  const [sourceName, setSourceName] = useState("");
  const [category, setCategory] = useState("");
  const [startDate, setStartDate] = useState<Date | undefined>(undefined);
  const [endDate, setEndDate] = useState<Date | undefined>(undefined);

  // 实际用于搜索的条件（点击搜索后更新）
  const [searchParams, setSearchParams] = useState({
    keyword: "",
    author: "",
    region: "",
    sourceName: "",
    category: "",
    startDate: "",
    endDate: "",
  });

  const [filterOptions, setFilterOptions] = useState<FilterOptions>({
    authors: [],
    regions: [],
    sourceNames: [],
    categories: [],
  });

  const [showExportModal, setShowExportModal] = useState(false);
  const [exportColumns, setExportColumns] = useState<ExportColumn[]>([]);
  const [selectedColumns, setSelectedColumns] = useState<string[]>([
    "source_id",
    "title",
    "author",
    "source_name",
    "region",
    "publish_time",
  ]);
  const [exporting, setExporting] = useState(false);

  // 导出历史相关状态
  const [exportHistory, setExportHistory] = useState<ExportHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyTotalPages, setHistoryTotalPages] = useState(0);

  useEffect(() => {
    fetch("/api/news/list", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "getFilterOptions" }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setFilterOptions(data.data);
        }
      })
      .catch(console.error);

    fetch("/api/news/export")
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setExportColumns(data.columns);
        }
      })
      .catch(console.error);
  }, []);

  const fetchNews = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        pageSize: pageSize.toString(),
        orderBy: "source_id",
        order: "desc",
      });

      if (searchParams.keyword) params.set("title", searchParams.keyword);
      if (searchParams.author) params.set("author", searchParams.author);
      if (searchParams.region) params.set("region", searchParams.region);
      if (searchParams.sourceName)
        params.set("sourceName", searchParams.sourceName);
      if (searchParams.category) params.set("category", searchParams.category);
      if (searchParams.startDate)
        params.set("startDate", searchParams.startDate);
      if (searchParams.endDate) params.set("endDate", searchParams.endDate);

      const res = await fetch(`/api/news/list?${params}`);
      const data = await res.json();

      if (data.success) {
        setNews(data.data);
        setTotal(data.total);
        setTotalPages(data.totalPages);
      }
    } catch (error) {
      console.error("获取新闻列表失败:", error);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, searchParams]);

  const fetchExportHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const params = new URLSearchParams({
        page: historyPage.toString(),
        pageSize: "10",
      });

      const res = await fetch(`/api/news/export/history?${params}`);
      const data = await res.json();

      if (data.success) {
        setExportHistory(data.data);
        setHistoryTotal(data.total);
        setHistoryTotalPages(data.totalPages);
      }
    } catch (error) {
      console.error("获取导出历史失败:", error);
    } finally {
      setHistoryLoading(false);
    }
  }, [historyPage]);

  useEffect(() => {
    fetchNews();
  }, [fetchNews]);

  useEffect(() => {
    fetchExportHistory();
  }, [fetchExportHistory]);

  const handleSearch = () => {
    setSearchParams({
      keyword,
      author,
      region: region === "all" ? "" : region,
      sourceName: sourceName === "all" ? "" : sourceName,
      category: category === "all" ? "" : category,
      startDate: startDate ? format(startDate, "yyyy-MM-dd") : "",
      endDate: endDate ? format(endDate, "yyyy-MM-dd") : "",
    });
    setPage(1);
  };

  const handleReset = () => {
    setKeyword("");
    setAuthor("");
    setRegion("");
    setSourceName("");
    setCategory("");
    setStartDate(undefined);
    setEndDate(undefined);
    setSearchParams({
      keyword: "",
      author: "",
      region: "",
      sourceName: "",
      category: "",
      startDate: "",
      endDate: "",
    });
    setPage(1);
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const body: Record<string, unknown> = {
        columns: selectedColumns,
        orderBy: "source_id",
        order: "desc",
      };

      if (searchParams.keyword) body.title = searchParams.keyword;
      if (searchParams.author) body.author = searchParams.author;
      if (searchParams.region) body.region = searchParams.region;
      if (searchParams.sourceName) body.sourceName = searchParams.sourceName;
      if (searchParams.category) body.category = searchParams.category;
      if (searchParams.startDate) body.startDate = searchParams.startDate;
      if (searchParams.endDate) body.endDate = searchParams.endDate;

      const res = await fetch("/api/news/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const error = await res.json();
        alert(error.error || "导出失败");
        return;
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `news_export_${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      setShowExportModal(false);
      // 刷新导出历史
      fetchExportHistory();
    } catch (error) {
      console.error("导出失败:", error);
      alert("导出失败");
    } finally {
      setExporting(false);
    }
  };

  const handleDeleteHistory = async (id: number) => {
    if (!confirm("确定要删除这条导出记录吗？")) return;

    try {
      const res = await fetch(`/api/news/export/history?id=${id}`, {
        method: "DELETE",
      });
      const data = await res.json();

      if (data.success) {
        fetchExportHistory();
      } else {
        alert(data.error || "删除失败");
      }
    } catch (error) {
      console.error("删除失败:", error);
      alert("删除失败");
    }
  };

  const toggleColumn = (key: string) => {
    setSelectedColumns((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  };

  const formatDateTime = (dateStr: string | null) => {
    if (!dateStr) return "-";
    return new Date(dateStr).toLocaleString("zh-CN");
  };

  const formatDateShort = (dateStr: string | null) => {
    if (!dateStr) return "-";
    return new Date(dateStr).toLocaleDateString("zh-CN");
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "crawled":
        return (
          <span title="已爬取" className="text-green-500">
            <CheckCircle2 className="h-5 w-5" />
          </span>
        );
      case "pending":
        return (
          <span title="待爬取" className="text-yellow-500">
            <Clock className="h-5 w-5" />
          </span>
        );
      case "failed":
        return (
          <span title="失败" className="text-red-500">
            <XCircle className="h-5 w-5" />
          </span>
        );
      default:
        return (
          <span title={status} className="text-gray-400">
            <HelpCircle className="h-5 w-5" />
          </span>
        );
    }
  };

  const buildFilterSummary = (item: ExportHistoryItem) => {
    const filters: string[] = [];
    if (item.keyword) filters.push(`标题: ${item.keyword}`);
    if (item.author) filters.push(`作者: ${item.author}`);
    if (item.region) filters.push(`地区: ${item.region}`);
    if (item.source_name) filters.push(`来源: ${item.source_name}`);
    if (item.start_date)
      filters.push(`从: ${formatDateShort(item.start_date)}`);
    if (item.end_date) filters.push(`至: ${formatDateShort(item.end_date)}`);
    return filters.length > 0 ? filters.join(", ") : "无筛选条件";
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold">新闻列表</h1>
        <p className="text-muted-foreground">查看和导出已爬取的新闻数据</p>
      </div>

      <Tabs defaultValue="list" className="space-y-6">
        <TabsList>
          <TabsTrigger value="list" className="flex items-center gap-1">
            <FileText className="w-4 h-4" />
            新闻列表
          </TabsTrigger>
          <TabsTrigger
            value="export-history"
            className="flex items-center gap-1"
          >
            <History className="w-4 h-4" />
            导出历史
          </TabsTrigger>
        </TabsList>

        {/* 新闻列表 Tab */}
        <TabsContent value="list" className="space-y-6">
          {/* 筛选区域 */}
          <Card>
            <CardHeader>
              <CardTitle>筛选条件</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* 第一行：标题搜索、作者、地区、来源、分类 */}
              <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
                <div className="space-y-2 md:col-span-3">
                  <Label>标题搜索</Label>
                  <Input
                    value={keyword}
                    onChange={(e) => setKeyword(e.target.value)}
                    placeholder="输入标题关键词"
                    onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>作者</Label>
                  <Input
                    value={author}
                    onChange={(e) => setAuthor(e.target.value)}
                    placeholder="输入作者名称"
                    onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>地区</Label>
                  <Select value={region} onValueChange={setRegion}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="全部" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">全部</SelectItem>
                      {filterOptions.regions.map((r) => (
                        <SelectItem key={r} value={r}>
                          {r}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2 md:col-span-3">
                  <Label>来源</Label>
                  <Select value={sourceName} onValueChange={setSourceName}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="全部" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">全部</SelectItem>
                      {filterOptions.sourceNames.map((s) => (
                        <SelectItem key={s} value={s}>
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>分类</Label>
                  <Select value={category} onValueChange={setCategory}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="全部" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">全部</SelectItem>
                      {filterOptions.categories.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* 第二行：日期范围、操作按钮 */}
              <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
                <div className="space-y-2 md:col-span-2">
                  <Label>开始日期</Label>
                  <DatePicker
                    value={startDate}
                    onChange={setStartDate}
                    placeholder="选择开始日期"
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>结束日期</Label>
                  <DatePicker
                    value={endDate}
                    onChange={setEndDate}
                    placeholder="选择结束日期"
                  />
                </div>
                <div className="flex items-end gap-2 md:col-span-8">
                  <Button onClick={handleSearch}>搜索</Button>
                  <Button variant="outline" onClick={handleReset}>
                    重置
                  </Button>
                  <Button
                    variant="secondary"
                    className="bg-green-600 text-white hover:bg-green-700"
                    onClick={() => setShowExportModal(true)}
                  >
                    导出 Excel
                  </Button>
                  <span className="text-sm text-muted-foreground ml-auto">
                    共 {total} 条记录
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* 表格 */}
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[80px]">ID</TableHead>
                    <TableHead className="min-w-[200px] max-w-[300px]">
                      标题
                    </TableHead>
                    <TableHead>来源</TableHead>
                    <TableHead>分类</TableHead>
                    <TableHead>作者</TableHead>
                    <TableHead>地区</TableHead>
                    <TableHead>发布时间</TableHead>
                    <TableHead className="w-[50px] text-center">状态</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <TableRow key={i}>
                        <TableCell>
                          <Skeleton className="h-4 w-16" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-4 w-full" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-4 w-20" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-4 w-16" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-4 w-16" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-4 w-16" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-4 w-32" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-4 w-5" />
                        </TableCell>
                      </TableRow>
                    ))
                  ) : news.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={8}
                        className="text-center py-8 text-muted-foreground"
                      >
                        暂无数据
                      </TableCell>
                    </TableRow>
                  ) : (
                    news.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="font-mono text-xs">
                          {item.source_id}
                        </TableCell>
                        <TableCell className="max-w-[300px]">
                          <Link
                            href={`/news/${item.source_id}`}
                            className="text-blue-600 hover:text-blue-800 hover:underline line-clamp-1 text-sm"
                            title={item.title}
                          >
                            {item.title}
                          </Link>
                        </TableCell>
                        <TableCell className="text-sm">
                          {item.source_name || "-"}
                        </TableCell>
                        <TableCell className="text-sm">
                          {item.category || "-"}
                        </TableCell>
                        <TableCell className="text-sm">
                          {item.author || "-"}
                        </TableCell>
                        <TableCell className="text-sm">
                          {item.region || "-"}
                        </TableCell>
                        <TableCell className="text-sm whitespace-nowrap">
                          {formatDateTime(item.publish_time)}
                        </TableCell>
                        <TableCell className="text-center">
                          {getStatusIcon(item.status)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>

              {/* 分页 */}
              {totalPages > 1 && (
                <div className="px-4 py-3 border-t flex items-center justify-between">
                  <div className="text-sm text-muted-foreground">
                    第 {page} / {totalPages} 页
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={page === 1}
                    >
                      上一页
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setPage((p) => Math.min(totalPages, p + 1))
                      }
                      disabled={page === totalPages}
                    >
                      下一页
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* 导出历史 Tab */}
        <TabsContent value="export-history">
          <Card>
            <CardHeader>
              <CardTitle>导出历史记录</CardTitle>
              <CardDescription>共 {historyTotal} 条导出记录</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>文件名</TableHead>
                    <TableHead>筛选条件</TableHead>
                    <TableHead>导出列</TableHead>
                    <TableHead>记录数</TableHead>
                    <TableHead>导出时间</TableHead>
                    <TableHead>操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {historyLoading ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <TableRow key={i}>
                        <TableCell>
                          <Skeleton className="h-4 w-8" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-4 w-40" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-4 w-48" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-4 w-24" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-4 w-12" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-4 w-32" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-4 w-16" />
                        </TableCell>
                      </TableRow>
                    ))
                  ) : exportHistory.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={7}
                        className="text-center py-8 text-muted-foreground"
                      >
                        暂无导出记录
                      </TableCell>
                    </TableRow>
                  ) : (
                    exportHistory.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="font-mono">{item.id}</TableCell>
                        <TableCell className="font-mono text-sm">
                          {item.file_name}
                        </TableCell>
                        <TableCell
                          className="max-w-xs truncate text-sm"
                          title={buildFilterSummary(item)}
                        >
                          {buildFilterSummary(item)}
                        </TableCell>
                        <TableCell className="text-sm">
                          {item.columns?.length || 0} 列
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">{item.total_count}</Badge>
                        </TableCell>
                        <TableCell className="text-sm">
                          {formatDateTime(item.created_at)}
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeleteHistory(item.id)}
                            className="text-red-600 hover:text-red-700 hover:bg-red-50"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>

              {/* 分页 */}
              {historyTotalPages > 1 && (
                <div className="flex items-center justify-between mt-4 pt-4 border-t">
                  <div className="text-sm text-muted-foreground">
                    第 {historyPage} / {historyTotalPages} 页
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setHistoryPage((p) => Math.max(1, p - 1))}
                      disabled={historyPage === 1}
                    >
                      上一页
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setHistoryPage((p) =>
                          Math.min(historyTotalPages, p + 1),
                        )
                      }
                      disabled={historyPage === historyTotalPages}
                    >
                      下一页
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* 导出弹窗 */}
      <Dialog open={showExportModal} onOpenChange={setShowExportModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>导出设置</DialogTitle>
            <DialogDescription>
              选择要导出的列，将导出当前筛选条件下的所有数据
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-3 py-4">
            {exportColumns.map((col) => (
              <div key={col.key} className="flex items-center space-x-2">
                <Checkbox
                  id={`col-${col.key}`}
                  checked={selectedColumns.includes(col.key)}
                  onCheckedChange={() => toggleColumn(col.key)}
                />
                <Label htmlFor={`col-${col.key}`} className="cursor-pointer">
                  {col.label}
                </Label>
              </div>
            ))}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowExportModal(false)}>
              取消
            </Button>
            <Button
              onClick={handleExport}
              disabled={exporting || selectedColumns.length === 0}
              className="bg-green-600 hover:bg-green-700"
            >
              {exporting ? "导出中..." : "确认导出"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
