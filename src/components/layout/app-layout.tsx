"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useAuth } from "@/components/auth-provider";
import { Navbar } from "./navbar";
import { Sidebar } from "./sidebar";
import { Loader2 } from "lucide-react";

// 不需要显示布局的页面
const noLayoutPages = ["/site-login"];

// 从 localStorage 获取初始侧边栏状态
function getInitialSidebarState(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const saved = localStorage.getItem("sidebar-collapsed");
    return saved !== null ? JSON.parse(saved) : false;
  } catch {
    return false;
  }
}

interface AppLayoutProps {
  children: React.ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const pathname = usePathname();
  const { user, loading } = useAuth();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    getInitialSidebarState,
  );

  // 保存侧边栏状态到 localStorage
  const handleToggleSidebar = () => {
    const newState = !sidebarCollapsed;
    setSidebarCollapsed(newState);
    localStorage.setItem("sidebar-collapsed", JSON.stringify(newState));
  };

  // 登录页不显示布局
  if (noLayoutPages.includes(pathname)) {
    return <>{children}</>;
  }

  // 加载中
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // 未登录时不显示布局（会被 AuthProvider 重定向）
  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* 顶部导航栏 */}
      <Navbar />

      {/* 侧边栏 */}
      <Sidebar collapsed={sidebarCollapsed} onToggle={handleToggleSidebar} />

      {/* 主内容区 */}
      <main
        className={cn(
          "pt-14 min-h-screen transition-all duration-300",
          sidebarCollapsed ? "pl-14" : "pl-56",
        )}
      >
        {children}
      </main>
    </div>
  );
}
