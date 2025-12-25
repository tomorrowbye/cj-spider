"use client";

import Link from "next/link";
import { useAuth } from "@/components/auth-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { Bug, LogOut, User, Shield, Settings } from "lucide-react";

export function Navbar() {
  const { user, logout } = useAuth();

  const handleLogout = async () => {
    await logout();
  };

  const getUserInitials = (username: string) => {
    return username.slice(0, 2).toUpperCase();
  };

  return (
    <header className="fixed top-0 left-0 right-0 z-50 h-14 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex h-full items-center justify-between px-4">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary">
            <Bug className="h-5 w-5 text-primary-foreground" />
          </div>
          <span className="font-semibold text-lg hidden sm:inline-block">
            CJ-Spider
          </span>
        </Link>

        {/* 右侧操作区 */}
        <div className="flex items-center gap-2">
          {/* 主题切换 */}
          <ThemeToggle />

          {/* 用户菜单 */}
          {user && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className="relative h-9 w-9 rounded-full"
                >
                  <Avatar className="h-9 w-9">
                    <AvatarFallback className="bg-primary text-primary-foreground">
                      {getUserInitials(user.username)}
                    </AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56" align="end" forceMount>
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col space-y-2">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium leading-none">
                        {user.username}
                      </p>
                      <Badge
                        variant={
                          user.role === "admin" ? "default" : "secondary"
                        }
                        className={
                          user.role === "admin"
                            ? "bg-purple-500 hover:bg-purple-600 text-xs"
                            : "text-xs"
                        }
                      >
                        {user.role === "admin" ? (
                          <>
                            <Shield className="w-3 h-3 mr-1" />
                            管理员
                          </>
                        ) : (
                          "用户"
                        )}
                      </Badge>
                    </div>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/profile" className="cursor-pointer">
                    <Settings className="mr-2 h-4 w-4" />
                    个人设置
                  </Link>
                </DropdownMenuItem>
                {user.role === "admin" && (
                  <DropdownMenuItem asChild>
                    <Link href="/users" className="cursor-pointer">
                      <User className="mr-2 h-4 w-4" />
                      账号管理
                    </Link>
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={handleLogout}
                  className="cursor-pointer text-red-600 focus:text-red-600"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  退出登录
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
    </header>
  );
}
