"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronLeft, ExternalLink, ChevronRight } from "lucide-react";

interface NewsDetail {
  id: number;
  source_id: string;
  source_url: string;
  title: string;
  content: string | null;
  author: string | null;
  source_name: string | null;
  region: string | null;
  publish_time: string | null;
  raw_html: string | null;
  status: string;
  crawled_at: string | null;
  created_at: string;
  updated_at: string;
}

export default function NewsDetailPage() {
  const params = useParams();
  const id = params.id as string;

  const [news, setNews] = useState<NewsDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showRawHtml, setShowRawHtml] = useState(false);

  useEffect(() => {
    if (!id) return;

    const fetchNews = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/news/detail?id=${id}`);
        const data = await res.json();

        if (data.success) {
          setNews(data.data);
        } else {
          setError(data.error || "获取新闻详情失败");
        }
      } catch (err) {
        console.error("获取新闻详情失败:", err);
        setError("网络错误，请稍后重试");
      } finally {
        setLoading(false);
      }
    };

    fetchNews();
  }, [id]);

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "-";
    return new Date(dateStr).toLocaleString("zh-CN");
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "crawled":
        return (
          <Badge className="bg-green-500 hover:bg-green-600">已爬取</Badge>
        );
      case "pending":
        return (
          <Badge
            variant="secondary"
            className="bg-yellow-500 text-white hover:bg-yellow-600"
          >
            待爬取
          </Badge>
        );
      case "failed":
        return <Badge variant="destructive">失败</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-background p-8">
        <div className="max-w-4xl mx-auto">
          <Card>
            <CardHeader>
              <Skeleton className="h-8 w-3/4" />
              <div className="flex gap-4 mt-4">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-20" />
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </CardContent>
          </Card>
        </div>
      </main>
    );
  }

  if (error || !news) {
    return (
      <main className="min-h-screen bg-background p-8">
        <div className="max-w-4xl mx-auto">
          <Card className="text-center py-12">
            <CardContent>
              <div className="text-destructive text-6xl mb-4">!</div>
              <h2 className="text-xl font-semibold mb-2">
                {error || "新闻不存在"}
              </h2>
              <Button asChild className="mt-4">
                <Link href="/news">返回列表</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background p-8">
      <div className="max-w-4xl mx-auto">
        {/* 顶部导航 */}
        <div className="flex items-center justify-between mb-6">
          <Button variant="ghost" asChild>
            <Link href="/news" className="flex items-center gap-1">
              <ChevronLeft className="w-4 h-4" />
              返回列表
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <a
              href={news.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1"
            >
              查看原文
              <ExternalLink className="w-4 h-4" />
            </a>
          </Button>
        </div>

        {/* 主要内容 */}
        <Card>
          <CardHeader className="space-y-4">
            <CardTitle className="text-2xl leading-relaxed">
              {news.title}
            </CardTitle>

            {/* 元信息 */}
            <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
              <div className="flex items-center gap-1">
                <span className="font-medium">ID:</span>
                <span className="font-mono">{news.source_id}</span>
              </div>
              {news.author && (
                <div className="flex items-center gap-1">
                  <span className="font-medium">作者:</span>
                  <span>{news.author}</span>
                </div>
              )}
              {news.source_name && (
                <div className="flex items-center gap-1">
                  <span className="font-medium">来源:</span>
                  <span>{news.source_name}</span>
                </div>
              )}
              {news.region && (
                <div className="flex items-center gap-1">
                  <span className="font-medium">地区:</span>
                  <span>{news.region}</span>
                </div>
              )}
              {news.publish_time && (
                <div className="flex items-center gap-1">
                  <span className="font-medium">发布时间:</span>
                  <span>{formatDate(news.publish_time)}</span>
                </div>
              )}
              {getStatusBadge(news.status)}
            </div>
          </CardHeader>

          <CardContent className="space-y-6">
            {/* 正文内容 */}
            {news.content ? (
              <div className="prose prose-neutral dark:prose-invert max-w-none">
                <div
                  className="leading-relaxed whitespace-pre-wrap"
                  dangerouslySetInnerHTML={{ __html: news.content }}
                />
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <p>暂无正文内容</p>
                {news.status === "pending" && (
                  <p className="text-sm mt-2">该新闻尚未爬取详情</p>
                )}
              </div>
            )}

            {/* 附加信息 */}
            <div className="pt-4 border-t">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-muted-foreground">
                <div>
                  <span className="font-medium">爬取时间: </span>
                  {formatDate(news.crawled_at)}
                </div>
                <div>
                  <span className="font-medium">创建时间: </span>
                  {formatDate(news.created_at)}
                </div>
              </div>
            </div>

            {/* 原始HTML */}
            {news.raw_html && (
              <Collapsible open={showRawHtml} onOpenChange={setShowRawHtml}>
                <CollapsibleTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1 text-muted-foreground"
                  >
                    <ChevronRight
                      className={`w-4 h-4 transition-transform ${showRawHtml ? "rotate-90" : ""}`}
                    />
                    {showRawHtml ? "隐藏原始HTML" : "查看原始HTML"}
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="mt-4 p-4 bg-muted rounded-lg overflow-x-auto">
                    <pre className="text-sm whitespace-pre-wrap font-mono">
                      {news.raw_html}
                    </pre>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
