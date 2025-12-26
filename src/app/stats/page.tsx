"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import {
  RefreshCw,
  FileText,
  CheckCircle,
  Clock,
  XCircle,
  CalendarDays,
  CalendarRange,
  TrendingUp,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";

interface OverviewData {
  total: number;
  crawled: number;
  pending: number;
  failed: number;
  todayCount: number;
  weekCount: number;
  successRate: number;
}

interface TrendData {
  crawlTrend: { date: string; count: number }[];
  publishTrend: { month: string; count: number }[];
}

interface DistributionData {
  regions: { name: string; count: number }[];
  sources: { name: string; count: number }[];
  authors: { name: string; count: number }[];
}

interface ContentData {
  lengthDistribution: { range: string; count: number }[];
  withImages: number;
  withoutImages: number;
  topTags: { tag: string; count: number }[];
}

// 多彩配色方案 - 主题色 + 丰富的色彩搭配
const CHART_COLORS = {
  primary: "#4f46e5", // Indigo-600 (主题色)
  secondary: "#06b6d4", // Cyan-500 (青色)
  tertiary: "#8b5cf6", // Violet-500 (紫色)
  quaternary: "#10b981", // Emerald-500 (绿色)
  quinary: "#f59e0b", // Amber-500 (琥珀色)
};

// 饼图和条形图使用的多彩渐变色系
const PIE_COLORS = [
  "#4f46e5", // Indigo-600 (靛蓝)
  "#06b6d4", // Cyan-500 (青色)
  "#8b5cf6", // Violet-500 (紫色)
  "#10b981", // Emerald-500 (绿色)
  "#f59e0b", // Amber-500 (琥珀色)
  "#ec4899", // Pink-500 (粉色)
  "#14b8a6", // Teal-500 (青绿)
  "#f97316", // Orange-500 (橙色)
  "#6366f1", // Indigo-500 (靛蓝浅)
  "#0ea5e9", // Sky-500 (天蓝)
];

export default function StatsPage() {
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [trend, setTrend] = useState<TrendData | null>(null);
  const [distribution, setDistribution] = useState<DistributionData | null>(
    null,
  );
  const [content, setContent] = useState<ContentData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [overviewRes, trendRes, distRes, contentRes] = await Promise.all([
        fetch("/api/stats/overview"),
        fetch("/api/stats/trend?days=30"),
        fetch("/api/stats/distribution"),
        fetch("/api/stats/content"),
      ]);

      const [overviewData, trendData, distData, contentData] =
        await Promise.all([
          overviewRes.json(),
          trendRes.json(),
          distRes.json(),
          contentRes.json(),
        ]);

      if (overviewData.success) setOverview(overviewData.data);
      if (trendData.success) setTrend(trendData.data);
      if (distData.success) setDistribution(distData.data);
      if (contentData.success) setContent(contentData.data);
    } catch (error) {
      console.error("获取统计数据失败:", error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchData();
  };

  const formatDate = (dateStr: string) => {
    return dateStr.slice(5); // MM-DD
  };

  // 自定义 Tooltip 样式
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-card border border-border rounded-lg p-3 shadow-lg">
          <p className="text-sm font-medium text-foreground mb-1">{label}</p>
          {payload.map((entry: any, index: number) => (
            <p key={index} className="text-sm" style={{ color: entry.color }}>
              {entry.name}: <span className="font-semibold">{entry.value}</span>
            </p>
          ))}
        </div>
      );
    }
    return null;
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-background p-8">
        <div className="max-w-7xl mx-auto space-y-6">
          <div className="flex items-center justify-between">
            <Skeleton className="h-10 w-32" />
            <Skeleton className="h-10 w-20" />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Card key={i}>
                <CardContent className="pt-6">
                  <Skeleton className="h-8 w-16 mb-2" />
                  <Skeleton className="h-4 w-20" />
                </CardContent>
              </Card>
            ))}
          </div>
          <Card>
            <CardHeader>
              <Skeleton className="h-6 w-40" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-[300px] w-full" />
            </CardContent>
          </Card>
        </div>
      </main>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* 标题栏 */}
      <div className="flex items-center justify-between">
        <div className="space-y-1.5">
          <h1 className="text-2xl font-semibold">数据统计</h1>
          <p className="text-muted-foreground text-sm text-muted-foreground">
            查看爬取数据分析和趋势
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          disabled={refreshing}
        >
          <RefreshCw
            className={`w-4 h-4 mr-1 ${refreshing ? "animate-spin" : ""}`}
          />
          刷新
        </Button>
      </div>

      {/* 概览卡片 */}
      {overview && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">总文章数</span>
              </div>
              <div className="text-2xl font-semibold mt-2">{overview.total}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-green-500" />
                <span className="text-sm text-muted-foreground">已爬取</span>
              </div>
              <div className="text-2xl font-semibold mt-2 text-green-600">
                {overview.crawled}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2">
                <Clock className="w-5 h-5 text-yellow-500" />
                <span className="text-sm text-muted-foreground">待爬取</span>
              </div>
              <div className="text-2xl font-semibold mt-2 text-yellow-600">
                {overview.pending}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2">
                <XCircle className="w-5 h-5 text-red-500" />
                <span className="text-sm text-muted-foreground">爬取失败</span>
              </div>
              <div className="text-2xl font-semibold mt-2 text-red-600">
                {overview.failed}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2">
                <CalendarDays className="w-5 h-5 text-blue-500" />
                <span className="text-sm text-muted-foreground">今日新增</span>
              </div>
              <div className="text-2xl font-semibold mt-2 text-blue-600">
                {overview.todayCount}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2">
                <CalendarRange className="w-5 h-5 text-purple-500" />
                <span className="text-sm text-muted-foreground">本周新增</span>
              </div>
              <div className="text-2xl font-semibold mt-2 text-purple-600">
                {overview.weekCount}
              </div>
            </CardContent>
          </Card>
          <Card className="md:col-span-2">
            <CardContent className="pt-6">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="w-5 h-5 text-green-500" />
                <span className="text-sm text-muted-foreground">
                  爬取成功率
                </span>
                <span className="ml-auto text-2xl font-bold text-green-600">
                  {overview.successRate}%
                </span>
              </div>
              <Progress value={overview.successRate} className="h-3" />
            </CardContent>
          </Card>
        </div>
      )}

      {/* 爬取趋势 */}
      {trend && trend.crawlTrend.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>爬取趋势（最近30天）</CardTitle>
            <CardDescription>每日爬取新闻数量变化</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trend.crawlTrend}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    className="stroke-muted"
                  />
                  <XAxis
                    dataKey="date"
                    tickFormatter={formatDate}
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={12}
                    tickLine={false}
                  />
                  <YAxis
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={12}
                    tickLine={false}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Line
                    type="monotone"
                    dataKey="count"
                    name="爬取数量"
                    stroke={CHART_COLORS.primary}
                    strokeWidth={2}
                    dot={{ fill: CHART_COLORS.primary, r: 4 }}
                    activeDot={{ r: 6 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 分布统计 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* 地区分布 */}
        {distribution && distribution.regions.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>地区分布</CardTitle>
              <CardDescription>新闻来源地区统计</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={distribution.regions.slice(0, 8)}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, percent }) =>
                        `${name} ${((percent || 0) * 100).toFixed(0)}%`
                      }
                      outerRadius={100}
                      fill="#8884d8"
                      dataKey="count"
                      animationBegin={0}
                      animationDuration={800}
                    >
                      {distribution.regions.slice(0, 8).map((_, index) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={PIE_COLORS[index % PIE_COLORS.length]}
                        />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        )}

        {/* 来源 Top 10 */}
        {distribution && distribution.sources.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>来源 Top 10</CardTitle>
              <CardDescription>新闻来源媒体排行</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={distribution.sources}
                    layout="vertical"
                    margin={{ left: 80 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="hsl(var(--border))"
                      opacity={0.3}
                    />
                    <XAxis
                      type="number"
                      stroke="hsl(var(--muted-foreground))"
                      fontSize={12}
                      tickLine={false}
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      stroke="hsl(var(--muted-foreground))"
                      width={75}
                      fontSize={11}
                      tickLine={false}
                    />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar
                      dataKey="count"
                      name="文章数"
                      fill={CHART_COLORS.secondary}
                      radius={[0, 4, 4, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        )}

        {/* 作者排行 */}
        {distribution && distribution.authors.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>作者排行 Top 10</CardTitle>
              <CardDescription>文章产出最多的作者</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={distribution.authors}
                    layout="vertical"
                    margin={{ left: 80 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      className="stroke-muted"
                    />
                    <XAxis type="number" className="text-xs" />
                    <YAxis
                      type="category"
                      dataKey="name"
                      className="text-xs"
                      width={75}
                      tick={{ fontSize: 11 }}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "8px",
                      }}
                    />
                    <Bar
                      dataKey="count"
                      name="文章数"
                      fill={CHART_COLORS.tertiary}
                      radius={[0, 4, 4, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        )}

        {/* 文章长度分布 */}
        {content && content.lengthDistribution.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>文章长度分布</CardTitle>
              <CardDescription>按字符数分段统计</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={content.lengthDistribution}>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="hsl(var(--border))"
                      opacity={0.3}
                    />
                    <XAxis
                      dataKey="range"
                      stroke="hsl(var(--muted-foreground))"
                      fontSize={12}
                      tickLine={false}
                    />
                    <YAxis
                      stroke="hsl(var(--muted-foreground))"
                      fontSize={12}
                      tickLine={false}
                    />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar
                      dataKey="count"
                      name="文章数"
                      fill={CHART_COLORS.quinary}
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* 图片统计 */}
      {content && (
        <Card>
          <CardHeader>
            <CardTitle>内容分析</CardTitle>
            <CardDescription>图片与标签统计</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* 图片占比 */}
              <div>
                <h4 className="font-medium mb-4">图片文章占比</h4>
                <div className="h-[200px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={[
                          { name: "有图片", value: content.withImages },
                          { name: "无图片", value: content.withoutImages },
                        ]}
                        cx="50%"
                        cy="50%"
                        innerRadius={50}
                        outerRadius={80}
                        fill="#8884d8"
                        dataKey="value"
                        label={({ name, percent }) =>
                          `${name} ${((percent || 0) * 100).toFixed(0)}%`
                        }
                      >
                        <Cell fill={CHART_COLORS.primary} />
                        <Cell fill={CHART_COLORS.quaternary} />
                      </Pie>
                      <Tooltip />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* 热门标签 */}
              <div>
                <h4 className="font-medium mb-4">热门标签 Top 10</h4>
                {content.topTags.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {content.topTags.slice(0, 10).map((item, index) => (
                      <span
                        key={item.tag}
                        className="px-3 py-1 rounded-full text-sm"
                        style={{
                          backgroundColor: `${PIE_COLORS[index % PIE_COLORS.length]}20`,
                          color: PIE_COLORS[index % PIE_COLORS.length],
                        }}
                      >
                        {item.tag} ({item.count})
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-muted-foreground text-sm">暂无标签数据</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
