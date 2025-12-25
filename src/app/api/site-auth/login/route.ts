import { NextRequest, NextResponse } from "next/server";
import { loginUser, getCookieName } from "@/lib/auth";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { username, password } = body;

    if (!username || !password) {
      return NextResponse.json(
        { success: false, error: "用户名和密码不能为空" },
        { status: 400 }
      );
    }

    const result = await loginUser(username, password);

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 401 }
      );
    }

    // 设置 Cookie
    const response = NextResponse.json({
      success: true,
      user: {
        id: result.user!.id,
        username: result.user!.username,
        role: result.user!.role,
      },
    });

    response.cookies.set(getCookieName(), result.token!, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60, // 7 days
      path: "/",
    });

    return response;
  } catch (error) {
    console.error("登录失败:", error);
    return NextResponse.json(
      { success: false, error: "登录失败" },
      { status: 500 }
    );
  }
}
