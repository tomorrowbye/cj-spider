"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/components/auth-provider";
import {
  Bug,
  Newspaper,
  BarChart3,
  Users,
  LogIn,
  CheckCircle,
  XCircle,
} from "lucide-react";

export default function Home() {
  const { user } = useAuth();
  const [loginStatus, setLoginStatus] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    checkLoginStatus();
  }, []);

  const checkLoginStatus = async () => {
    try {
      const response = await fetch("/api/auth/status", {
        credentials: "include",
      });
      const data = await response.json();
      setLoginStatus(data.loggedIn);
    } catch {
      setLoginStatus(false);
    } finally {
      setChecking(false);
    }
  };

  const quickLinks = [
    {
      href: "/crawl",
      icon: Bug,
      title: "爬取任务",
      description: "管理新闻爬取任务",
      color: "text-blue-500",
    },
    {
      href: "/news",
      icon: Newspaper,
      title: "新闻列表",
      description: "查看已爬取的新闻",
      color: "text-green-500",
    },
    {
      href: "/stats",
      icon: BarChart3,
      title: "数据统计",
      description: "查看爬取统计数据",
      color: "text-purple-500",
    },
  ];

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* 欢迎区域 */}
      <div className="space-y-2">
        <h1 className="text-3xl font-bold">欢迎回来，{user?.username}</h1>
        <p className="text-muted-foreground">CJ-Spider 新闻爬虫管理系统</p>
      </div>

      {/* 状态卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* 爬虫登录状态 */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <LogIn className="h-4 w-4" />
              爬虫登录状态
            </CardTitle>
            <CardDescription>安徽财经网账号</CardDescription>
          </CardHeader>
          <CardContent>
            {checking ? (
              <div className="flex items-center gap-2">
                <Skeleton className="h-5 w-5 rounded-full" />
                <Skeleton className="h-4 w-20" />
              </div>
            ) : loginStatus ? (
              <div className="flex items-center gap-2">
                <CheckCircle className="h-5 w-5 text-green-500" />
                <span className="text-green-600 font-medium">已登录</span>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <XCircle className="h-5 w-5 text-red-500" />
                  <span className="text-red-600 font-medium">未登录</span>
                </div>
                <Button asChild size="sm">
                  <Link href="/login">去登录</Link>
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* 用户信息 */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <Users className="h-4 w-4" />
              当前用户
            </CardTitle>
            <CardDescription>账号信息</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-primary flex items-center justify-center text-primary-foreground font-medium">
                {user?.username.slice(0, 2).toUpperCase()}
              </div>
              <div>
                <p className="font-medium">{user?.username}</p>
                <Badge
                  variant={user?.role === "admin" ? "default" : "secondary"}
                  className={
                    user?.role === "admin"
                      ? "bg-purple-500 hover:bg-purple-600 text-xs mt-1"
                      : "text-xs mt-1"
                  }
                >
                  {user?.role === "admin" ? "管理员" : "普通用户"}
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 快速入口 */}
      <Card>
        <CardHeader>
          <CardTitle>快速入口</CardTitle>
          <CardDescription>常用功能快捷访问</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {quickLinks.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="flex items-center gap-4 p-4 rounded-lg border hover:bg-accent transition-colors"
                >
                  <div className={`p-2 rounded-md bg-muted ${item.color}`}>
                    <Icon className="h-6 w-6" />
                  </div>
                  <div>
                    <h3 className="font-medium">{item.title}</h3>
                    <p className="text-sm text-muted-foreground">
                      {item.description}
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
