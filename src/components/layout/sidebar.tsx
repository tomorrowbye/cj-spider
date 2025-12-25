"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import { useAuth } from "@/components/auth-provider";
import {
  Home,
  Bug,
  Newspaper,
  BarChart3,
  Users,
  LogIn,
  ChevronLeft,
  ChevronRight,
  PanelLeftClose,
  PanelLeft,
} from "lucide-react";

interface NavItem {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  adminOnly?: boolean;
}

const navItems: NavItem[] = [
  {
    href: "/",
    icon: Home,
    label: "首页",
  },
  {
    href: "/crawl",
    icon: Bug,
    label: "爬取任务",
  },
  {
    href: "/news",
    icon: Newspaper,
    label: "新闻列表",
  },
  {
    href: "/stats",
    icon: BarChart3,
    label: "数据统计",
  },
];

const adminItems: NavItem[] = [
  {
    href: "/users",
    icon: Users,
    label: "账号管理",
    adminOnly: true,
  },
];

const toolItems: NavItem[] = [
  {
    href: "/login",
    icon: LogIn,
    label: "爬虫登录",
  },
];

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const pathname = usePathname();
  const { user } = useAuth();

  const isActive = (href: string) => {
    if (href === "/") {
      return pathname === "/";
    }
    return pathname.startsWith(href);
  };

  const NavLink = ({ item }: { item: NavItem }) => {
    const Icon = item.icon;
    const active = isActive(item.href);

    const linkContent = (
      <Link
        href={item.href}
        className={cn(
          "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
          "hover:bg-accent hover:text-accent-foreground",
          active
            ? "bg-accent text-accent-foreground"
            : "text-muted-foreground",
          collapsed && "justify-center px-2"
        )}
      >
        <Icon className="h-4 w-4 shrink-0" />
        {!collapsed && <span>{item.label}</span>}
      </Link>
    );

    if (collapsed) {
      return (
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>{linkContent}</TooltipTrigger>
          <TooltipContent side="right" sideOffset={10}>
            {item.label}
          </TooltipContent>
        </Tooltip>
      );
    }

    return linkContent;
  };

  return (
    <TooltipProvider>
      <aside
        className={cn(
          "fixed left-0 top-14 bottom-0 z-40 flex flex-col border-r bg-background transition-all duration-300",
          collapsed ? "w-14" : "w-56"
        )}
      >
        {/* 导航菜单 */}
        <div className="flex-1 overflow-y-auto py-4 px-2">
          {/* 主导航 */}
          <div className="space-y-1">
            {!collapsed && (
              <div className="px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                导航
              </div>
            )}
            {navItems.map((item) => (
              <NavLink key={item.href} item={item} />
            ))}
          </div>

          <Separator className="my-4" />

          {/* 管理员功能 */}
          {user?.role === "admin" && (
            <>
              <div className="space-y-1">
                {!collapsed && (
                  <div className="px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    管理
                  </div>
                )}
                {adminItems.map((item) => (
                  <NavLink key={item.href} item={item} />
                ))}
              </div>
              <Separator className="my-4" />
            </>
          )}

          {/* 工具 */}
          <div className="space-y-1">
            {!collapsed && (
              <div className="px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                工具
              </div>
            )}
            {toolItems.map((item) => (
              <NavLink key={item.href} item={item} />
            ))}
          </div>
        </div>

        {/* 收起/展开按钮 */}
        <div className="border-t p-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggle}
            className={cn(
              "w-full justify-center",
              !collapsed && "justify-start"
            )}
          >
            {collapsed ? (
              <PanelLeft className="h-4 w-4" />
            ) : (
              <>
                <PanelLeftClose className="h-4 w-4 mr-2" />
                <span>收起菜单</span>
              </>
            )}
          </Button>
        </div>
      </aside>
    </TooltipProvider>
  );
}
