import { NextRequest, NextResponse } from "next/server";
import {
  getCurrentUser,
  updateUserPassword,
  verifyPassword,
  hashPassword,
} from "@/lib/auth";
import { getSupabaseClient } from "@/lib/supabase";

/**
 * 更新个人密码
 */
export async function PATCH(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const body = await request.json();
    const { currentPassword, newPassword } = body;

    if (!currentPassword || !newPassword) {
      return NextResponse.json(
        { error: "请填写当前密码和新密码" },
        { status: 400 }
      );
    }

    if (newPassword.length < 4) {
      return NextResponse.json(
        { error: "新密码长度至少为4位" },
        { status: 400 }
      );
    }

    // 验证当前密码
    const supabase = getSupabaseClient();
    const { data: userData, error: fetchError } = await supabase
      .from("site_users")
      .select("password_hash")
      .eq("id", user.id)
      .single();

    if (fetchError || !userData) {
      return NextResponse.json({ error: "用户不存在" }, { status: 404 });
    }

    const isValid = await verifyPassword(currentPassword, userData.password_hash);
    if (!isValid) {
      return NextResponse.json({ error: "当前密码错误" }, { status: 400 });
    }

    // 更新密码
    const result = await updateUserPassword(user.id, newPassword);
    if (!result.success) {
      return NextResponse.json(
        { error: result.error || "更新密码失败" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, message: "密码修改成功" });
  } catch (error) {
    console.error("Update password error:", error);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
