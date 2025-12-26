"use client";

import { useRouter } from "next/navigation";
import LoginForm from "@/components/LoginForm";

export default function LoginPage() {
  const router = useRouter();

  const handleLoginSuccess = () => {
    router.push("/crawl");
  };

  return (
    <div className="p-6 max-w-lg mx-auto space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">爬虫登录</h1>
        <p className="text-muted-foreground">
          登录安徽财经网账号以进行数据爬取
        </p>
      </div>

      <LoginForm onLoginSuccess={handleLoginSuccess} />
    </div>
  );
}
