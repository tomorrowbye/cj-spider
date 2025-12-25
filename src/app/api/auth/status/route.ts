import { NextRequest, NextResponse } from "next/server";
import { checkLoginStatus } from "@/lib/cj-auth";

export async function GET(request: NextRequest) {
  try {
    // 从我们的 Cookie 中获取原站登录 Cookie
    const cjAuth = request.cookies.get("cj_auth")?.value;

    if (!cjAuth) {
      return NextResponse.json({ loggedIn: false });
    }

    const cjCookies = decodeURIComponent(cjAuth);
    const isLoggedIn = await checkLoginStatus(cjCookies);

    return NextResponse.json({ loggedIn: isLoggedIn });
  } catch (error) {
    console.error("检查登录状态失败:", error);
    return NextResponse.json({ loggedIn: false });
  }
}
