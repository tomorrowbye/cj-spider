import { NextRequest, NextResponse } from "next/server";
import { login } from "@/lib/cj-auth";
import { getSession, deleteSession } from "@/lib/session-store";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { username, password, code } = body;

    if (!username || !password || !code) {
      return NextResponse.json(
        { success: false, error: "请填写完整的登录信息" },
        { status: 400 },
      );
    }

    // 从我们的会话 Cookie 中获取会话 ID
    const sessionId = request.cookies.get("cj_session")?.value;

    if (!sessionId) {
      return NextResponse.json(
        { success: false, error: "验证码已过期，请刷新验证码" },
        { status: 400 },
      );
    }

    // 从会话存储中获取原站 Cookie
    const cjCookies = getSession(sessionId);

    if (!cjCookies) {
      return NextResponse.json(
        { success: false, error: "验证码已过期，请刷新验证码" },
        { status: 400 },
      );
    }

    console.log("登录参数:", { username, code, cjCookies });

    const result = await login({
      username,
      password,
      code,
      cookie: cjCookies,
    });

    console.log("登录结果:", result);

    if (result.success && result.cookies) {
      const response = NextResponse.json({ success: true });

      // 删除验证码会话
      deleteSession(sessionId);
      response.headers.append(
        "Set-Cookie",
        "cj_session=; Path=/; HttpOnly; Max-Age=0",
      );

      // 保存登录后的原站 Cookie 到我们自己的 Cookie
      const loginCookieString = result.cookies
        .map((c) => c.split(";")[0])
        .join("; ");
      response.headers.append(
        "Set-Cookie",
        `cj_auth=${encodeURIComponent(loginCookieString)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`,
      );

      return response;
    }

    return NextResponse.json(
      { success: false, error: result.error || "登录失败" },
      { status: 401 },
    );
  } catch (error) {
    console.error("登录失败:", error);
    return NextResponse.json(
      { success: false, error: "登录请求处理失败" },
      { status: 500 },
    );
  }
}
