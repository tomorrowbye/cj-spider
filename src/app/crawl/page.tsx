"use client";

import { useState, useEffect, useCallback } from "react";
import {
  formatDateTime as formatDateTimeUtil,
  formatDurationFromDates,
  formatDuration,
} from "@/lib/date-utils";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Pagination } from "@/components/ui/pagination";
import {
  History,
  Download,
  Clock,
  Zap,
  Newspaper,
  XCircle,
} from "lucide-react";

interface CrawlProgress {
  sessionId: string;
  status: "running" | "paused" | "completed" | "failed";
  phase: "list" | "detail" | "completed";
  currentPage: number;
  totalPages: number;
  totalNews: number;
  pendingNews: number;
  crawledNews: number;
  failedNews: number;
  avgSpeed: number;
  estimatedTime: number;
}

interface Stats {
  total: number;
  pending: number;
  crawled: number;
  failed: number;
}

interface HistoryItem {
  id: number;
  session_name: string;
  total_pages: number;
  current_page: number;
  total_news: number;
  crawled_news: number;
  status: string;
  started_at: string;
  finished_at: string | null;
}

interface ExportColumn {
  key: string;
  label: string;
}

export default function CrawlPage() {
  const [startPage, setStartPage] = useState(1);
  const [endPage, setEndPage] = useState(10);
  const [skipExisting, setSkipExisting] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [currentTask, setCurrentTask] = useState<CrawlProgress | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);

  // 历史记录相关状态
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyTotalPages, setHistoryTotalPages] = useState(0);
  const [historyStatus, setHistoryStatus] = useState("all");

  // 导出相关状态
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportColumns, setExportColumns] = useState<ExportColumn[]>([]);
  const [selectedColumns, setSelectedColumns] = useState<string[]>([
    "id",
    "session_name",
    "total_news",
    "crawled_news",
    "status",
    "started_at",
    "finished_at",
    "duration",
  ]);
  const [exporting, setExporting] = useState(false);

  const fetchStats = useCallback(async () => {
    try {
      const response = await fetch("/api/crawl/stats");
      const data = await response.json();
      if (data.success) {
        setStats(data.data);
      }
    } catch (err) {
      console.error("获取统计失败:", err);
    }
  }, []);

  const fetchTaskStatus = useCallback(async (sessionId: string) => {
    try {
      const response = await fetch(`/api/crawl/status?sessionId=${sessionId}`);
      const data = await response.json();
      if (data.success) {
        setCurrentTask(data.data);
        if (data.data.status === "running") {
          setTimeout(() => fetchTaskStatus(sessionId), 1500);
        }
      }
    } catch (err) {
      console.error("获取任务状态失败:", err);
    }
  }, []);

  const fetchHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const params = new URLSearchParams({
        page: historyPage.toString(),
        pageSize: "10",
      });
      if (historyStatus !== "all") {
        params.set("status", historyStatus);
      }

      const response = await fetch(`/api/crawl/history?${params}`);
      const data = await response.json();
      if (data.success) {
        setHistory(data.data);
        setHistoryTotal(data.total);
        setHistoryTotalPages(data.totalPages);
      }
    } catch (err) {
      console.error("获取历史记录失败:", err);
    } finally {
      setHistoryLoading(false);
    }
  }, [historyPage, historyStatus]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  useEffect(() => {
    // 获取导出列配置
    fetch("/api/crawl/history/export")
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setExportColumns(data.columns);
        }
      })
      .catch(console.error);
  }, []);

  // 页面加载时检查是否有正在运行的任务
  useEffect(() => {
    const checkRunningTask = async () => {
      try {
        const response = await fetch("/api/crawl/current");
        const data = await response.json();
        if (data.success && data.data) {
          setCurrentTask(data.data);
          if (data.data.status === "running") {
            fetchTaskStatus(data.data.sessionId);
          }
        }
      } catch (err) {
        console.error("检查运行任务失败:", err);
      }
    };
    checkRunningTask();
  }, [fetchTaskStatus]);

  const handleStart = async () => {
    setError("");
    setLoading(true);

    try {
      const response = await fetch("/api/crawl/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startPage, endPage, skipExisting }),
        credentials: "include",
      });

      const data = await response.json();

      if (data.success) {
        setCurrentTask(data.data);
        fetchTaskStatus(data.data.sessionId);
        // 刷新历史记录
        setTimeout(fetchHistory, 1000);
      } else {
        setError(data.error || "启动失败");
      }
    } catch {
      setError("网络错误");
    } finally {
      setLoading(false);
    }
  };

  const handlePause = async () => {
    if (!currentTask) return;

    try {
      const response = await fetch("/api/crawl/pause", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: currentTask.sessionId }),
      });

      const data = await response.json();
      if (data.success) {
        setCurrentTask((prev) => (prev ? { ...prev, status: "paused" } : null));
      }
    } catch (err) {
      console.error("暂停失败:", err);
    }
  };

  const handleResume = async () => {
    if (!currentTask) return;

    try {
      const response = await fetch("/api/crawl/resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: currentTask.sessionId }),
        credentials: "include",
      });

      const data = await response.json();
      if (data.success) {
        setCurrentTask((prev) =>
          prev ? { ...prev, status: "running" } : null,
        );
        fetchTaskStatus(currentTask.sessionId);
      }
    } catch (err) {
      console.error("继续失败:", err);
    }
  };

  const handleRetry = async () => {
    try {
      const response = await fetch("/api/crawl/retry", {
        method: "POST",
        credentials: "include",
      });

      const data = await response.json();
      if (data.success) {
        alert(data.message);
        fetchStats();
      } else {
        alert(data.error);
      }
    } catch {
      alert("重试失败");
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const body: Record<string, unknown> = {
        columns: selectedColumns,
      };
      if (historyStatus !== "all") {
        body.status = historyStatus;
      }

      const res = await fetch("/api/crawl/history/export", {
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
      a.download = `crawl_history_${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      setShowExportModal(false);
    } catch (error) {
      console.error("导出失败:", error);
      alert("导出失败");
    } finally {
      setExporting(false);
    }
  };

  const toggleColumn = (key: string) => {
    setSelectedColumns((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "running":
        return <Badge className="bg-blue-500 hover:bg-blue-600">运行中</Badge>;
      case "paused":
        return (
          <Badge
            variant="secondary"
            className="bg-yellow-500 text-white hover:bg-yellow-600"
          >
            已暂停
          </Badge>
        );
      case "completed":
        return (
          <Badge className="bg-green-500 hover:bg-green-600">已完成</Badge>
        );
      case "failed":
        return <Badge variant="destructive">失败</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getPhaseBadge = (phase: string) => {
    switch (phase) {
      case "list":
        return (
          <Badge variant="outline" className="text-blue-600 border-blue-600">
            列表爬取
          </Badge>
        );
      case "detail":
        return (
          <Badge
            variant="outline"
            className="text-purple-600 border-purple-600"
          >
            详情爬取
          </Badge>
        );
      case "completed":
        return (
          <Badge variant="outline" className="text-green-600 border-green-600">
            已完成
          </Badge>
        );
      default:
        return <Badge variant="outline">{phase}</Badge>;
    }
  };

  const formatDate = formatDateTimeUtil;
  const formatDurationDisplay = formatDurationFromDates;

  const formatEstimatedTime = (minutes: number) => {
    if (minutes <= 0) return "-";
    const formatted = formatDuration(minutes);
    return formatted === "-" ? "-" : `约 ${formatted}`;
  };

  // 计算详情爬取进度
  const getDetailProgress = () => {
    if (!currentTask || currentTask.totalNews === 0) return 0;
    const processed = currentTask.crawledNews + currentTask.failedNews;
    return Math.round((processed / currentTask.totalNews) * 100);
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">爬取任务</h1>
        <p className="text-muted-foreground">管理新闻爬取任务和查看历史记录</p>
      </div>

      {/* 统计卡片 */}
      {stats ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="border-l-4 border-l-blue-400">
            <CardContent className="py-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground mb-1.5">
                    总文章数
                  </p>
                  <div className="text-xl font-semibold">{stats.total}</div>
                </div>
                <div className="w-10 h-10 bg-blue-50 dark:bg-blue-950 rounded-md flex items-center justify-center">
                  <Newspaper className="w-5 h-5 text-blue-600" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-l-4 border-l-amber-400">
            <CardContent className="py-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground mb-1.5">待爬取</p>
                  <div className="text-xl font-semibold">{stats.pending}</div>
                </div>
                <div className="w-10 h-10 bg-amber-50 dark:bg-amber-950 rounded-md flex items-center justify-center">
                  <Clock className="w-5 h-5 text-amber-600" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-l-4 border-l-emerald-400">
            <CardContent className="py-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground mb-1.5">已完成</p>
                  <div className="text-xl font-semibold">{stats.crawled}</div>
                </div>
                <div className="w-10 h-10 bg-emerald-50 dark:bg-emerald-950 rounded-md flex items-center justify-center">
                  <Zap className="w-5 h-5 text-emerald-600" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-l-4 border-l-rose-400">
            <CardContent className="py-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground mb-1.5">失败</p>
                  <div className="text-xl font-semibold">{stats.failed}</div>
                </div>
                <div className="w-10 h-10 bg-rose-50 dark:bg-rose-950 rounded-md flex items-center justify-center">
                  <XCircle className="w-5 h-5 text-rose-600" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="py-4">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <Skeleton className="h-3 w-16 mb-2" />
                    <Skeleton className="h-6 w-12" />
                  </div>
                  <Skeleton className="w-10 h-10 rounded-md" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Tabs defaultValue="task" className="space-y-6">
        <TabsList>
          <TabsTrigger value="task">爬取任务</TabsTrigger>
          <TabsTrigger value="history" className="flex items-center gap-1">
            <History className="w-4 h-4" />
            历史记录
          </TabsTrigger>
        </TabsList>

        {/* 爬取任务 Tab */}
        <TabsContent value="task" className="space-y-6">
          {/* 创建任务表单 */}
          <Card>
            <CardHeader>
              <CardTitle>创建爬取任务</CardTitle>
              <CardDescription>设置爬取的页码范围和选项</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="startPage">起始页码</Label>
                    <Input
                      id="startPage"
                      type="number"
                      min={1}
                      value={startPage}
                      onChange={(e) =>
                        setStartPage(parseInt(e.target.value) || 1)
                      }
                      disabled={loading || currentTask?.status === "running"}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="endPage">结束页码</Label>
                    <Input
                      id="endPage"
                      type="number"
                      min={startPage}
                      value={endPage}
                      onChange={(e) =>
                        setEndPage(parseInt(e.target.value) || startPage)
                      }
                      disabled={loading || currentTask?.status === "running"}
                    />
                  </div>
                </div>

                <div className="flex items-center space-x-2 py-1">
                  <Checkbox
                    id="skipExisting"
                    checked={skipExisting}
                    onCheckedChange={(checked) =>
                      setSkipExisting(checked as boolean)
                    }
                    disabled={loading || currentTask?.status === "running"}
                  />
                  <Label
                    htmlFor="skipExisting"
                    className="cursor-pointer text-sm"
                  >
                    跳过已爬取的文章
                  </Label>
                </div>

                {error && (
                  <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}

                <div className="flex flex-wrap gap-2 pt-1">
                  <Button
                    onClick={handleStart}
                    disabled={loading || currentTask?.status === "running"}
                  >
                    {loading ? "启动中..." : "开始爬取"}
                  </Button>

                  {stats && stats.failed > 0 && (
                    <Button variant="outline" onClick={handleRetry}>
                      重试失败 ({stats.failed})
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* 任务进度 */}
          {currentTask && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <CardTitle>任务进度</CardTitle>
                    {getPhaseBadge(currentTask.phase)}
                  </div>
                  {getStatusBadge(currentTask.status)}
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* 阶段1: 列表页进度 */}
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="font-medium">阶段1: 列表页爬取</span>
                    <span>
                      {currentTask.currentPage} / {currentTask.totalPages} 页 (
                      {Math.round(
                        (currentTask.currentPage / currentTask.totalPages) *
                          100,
                      )}
                      %)
                    </span>
                  </div>
                  <Progress
                    value={
                      (currentTask.currentPage / currentTask.totalPages) * 100
                    }
                    className="h-2"
                  />
                  <div className="text-xs text-muted-foreground">
                    发现 {currentTask.totalNews} 篇文章
                  </div>
                </div>

                {/* 阶段2: 详情页进度 */}
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="font-medium">阶段2: 详情页爬取</span>
                    <span>
                      {currentTask.crawledNews + currentTask.failedNews} /{" "}
                      {currentTask.totalNews} 篇 ({getDetailProgress()}%)
                    </span>
                  </div>
                  <Progress
                    value={getDetailProgress()}
                    className={`h-2 ${currentTask.phase === "detail" ? "" : "opacity-50"}`}
                  />
                  {currentTask.phase === "detail" &&
                    currentTask.avgSpeed > 0 && (
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Zap className="w-3 h-3" />
                          {currentTask.avgSpeed} 篇/分钟
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          剩余 {formatEstimatedTime(currentTask.estimatedTime)}
                        </span>
                      </div>
                    )}
                </div>

                {/* 统计卡片 */}
                <div className="grid grid-cols-4 gap-4">
                  <div className="text-center p-3 bg-muted rounded-lg">
                    <div className="text-lg font-semibold">
                      {currentTask.totalNews}
                    </div>
                    <div className="text-xs text-muted-foreground">发现</div>
                  </div>
                  <div className="text-center p-3 bg-yellow-50 dark:bg-yellow-950 rounded-lg">
                    <div className="text-lg font-semibold text-yellow-600">
                      {currentTask.pendingNews}
                    </div>
                    <div className="text-xs text-muted-foreground">待爬取</div>
                  </div>
                  <div className="text-center p-3 bg-green-50 dark:bg-green-950 rounded-lg">
                    <div className="text-lg font-semibold text-green-600">
                      {currentTask.crawledNews}
                    </div>
                    <div className="text-xs text-muted-foreground">已爬取</div>
                  </div>
                  <div className="text-center p-3 bg-red-50 dark:bg-red-950 rounded-lg">
                    <div className="text-lg font-semibold text-red-600">
                      {currentTask.failedNews}
                    </div>
                    <div className="text-xs text-muted-foreground">失败</div>
                  </div>
                </div>

                <div className="flex gap-2">
                  {currentTask.status === "running" && (
                    <Button variant="secondary" onClick={handlePause}>
                      暂停
                    </Button>
                  )}
                  {currentTask.status === "paused" && (
                    <Button onClick={handleResume}>继续</Button>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* 历史记录 Tab */}
        <TabsContent value="history">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>爬取历史记录</CardTitle>
                  <CardDescription>共 {historyTotal} 条记录</CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Select
                    value={historyStatus}
                    onValueChange={(value) => {
                      setHistoryStatus(value);
                      setHistoryPage(1);
                    }}
                  >
                    <SelectTrigger className="w-[120px]">
                      <SelectValue placeholder="全部状态" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">全部状态</SelectItem>
                      <SelectItem value="completed">已完成</SelectItem>
                      <SelectItem value="running">运行中</SelectItem>
                      <SelectItem value="paused">已暂停</SelectItem>
                      <SelectItem value="failed">失败</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowExportModal(true)}
                    className="flex items-center gap-1"
                  >
                    <Download className="w-4 h-4" />
                    导出
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>任务名称</TableHead>
                    <TableHead>进度</TableHead>
                    <TableHead>文章数</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>开始时间</TableHead>
                    <TableHead>耗时</TableHead>
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
                          <Skeleton className="h-4 w-32" />
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
                          <Skeleton className="h-4 w-32" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-4 w-20" />
                        </TableCell>
                      </TableRow>
                    ))
                  ) : history.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={7}
                        className="text-center py-8 text-muted-foreground"
                      >
                        暂无历史记录
                      </TableCell>
                    </TableRow>
                  ) : (
                    history.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="font-mono">{item.id}</TableCell>
                        <TableCell>{item.session_name || "-"}</TableCell>
                        <TableCell>
                          {item.current_page}/{item.total_pages} 页
                        </TableCell>
                        <TableCell>
                          <span className="text-green-600">
                            {item.crawled_news}
                          </span>
                          /{item.total_news}
                        </TableCell>
                        <TableCell>{getStatusBadge(item.status)}</TableCell>
                        <TableCell className="text-sm">
                          {formatDate(item.started_at)}
                        </TableCell>
                        <TableCell className="text-sm">
                          {formatDurationDisplay(
                            item.started_at,
                            item.finished_at,
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>

              {/* 分页 */}
              <div className="mt-4">
                <Pagination
                  currentPage={historyPage}
                  totalPages={historyTotalPages}
                  pageSize={10}
                  total={historyTotal}
                  onPageChange={setHistoryPage}
                  showPageSizeSelector={false}
                  showQuickJumper={true}
                  showTotal={true}
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* 导出弹窗 */}
      <Dialog open={showExportModal} onOpenChange={setShowExportModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>导出历史记录</DialogTitle>
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
