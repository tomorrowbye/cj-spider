"use client";

import { useState, useCallback, useEffect } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface LoginFormProps {
  onLoginSuccess?: () => void;
}

export default function LoginForm({ onLoginSuccess }: LoginFormProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [captchaUrl, setCaptchaUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setCaptchaUrl(`/api/auth/captcha?t=${Date.now()}`);
  }, []);

  const refreshCaptcha = useCallback(() => {
    setCaptchaUrl(`/api/auth/captcha?t=${Date.now()}`);
    setCode("");
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ username, password, code }),
        credentials: "include",
      });

      const data = await response.json();

      if (data.success) {
        onLoginSuccess?.();
      } else {
        setError(data.error || "登录失败");
        refreshCaptcha();
      }
    } catch {
      setError("网络错误，请稍后重试");
      refreshCaptcha();
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="w-full">
      <CardHeader className="space-y-2 pb-6">
        <CardTitle className="text-xl text-center">安徽财经网登录</CardTitle>
        <CardDescription className="text-center">
          请输入您的账号信息
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="username">用户名</Label>
            <Input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="请输入用户名"
              required
              disabled={loading}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">密码</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="请输入密码"
              required
              disabled={loading}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="code">验证码</Label>
            <div className="flex gap-2">
              <Input
                id="code"
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="请输入验证码"
                required
                disabled={loading}
                maxLength={5}
                className="flex-1"
              />
              <button
                type="button"
                onClick={refreshCaptcha}
                className="flex-shrink-0 cursor-pointer"
                title="点击刷新验证码"
              >
                {captchaUrl ? (
                  <Image
                    src={captchaUrl}
                    alt="验证码"
                    width={120}
                    height={26}
                    className="h-9 w-auto rounded border"
                    unoptimized
                  />
                ) : (
                  <div className="h-9 w-[120px] rounded border bg-muted flex items-center justify-center text-muted-foreground text-sm">
                    加载中...
                  </div>
                )}
              </button>
            </div>
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "登录中..." : "登录"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
