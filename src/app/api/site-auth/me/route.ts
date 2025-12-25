import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";

export async function GET() {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        { success: false, error: "未登录" },
        { status: 401 }
      );
    }

    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        last_login_at: user.last_login_at,
      },
    });
  } catch (error) {
    console.error("获取用户信息失败:", error);
    return NextResponse.json(
      { success: false, error: "获取用户信息失败" },
      { status: 500 }
    );
  }
}
