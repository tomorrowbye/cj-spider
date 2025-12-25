import { NextRequest, NextResponse } from "next/server";
import {
  getCurrentUser,
  getUserList,
  createUser,
  updateUserStatus,
  updateUserPassword,
  deleteUser,
} from "@/lib/auth";

// 获取用户列表
export async function GET() {
  try {
    const currentUser = await getCurrentUser();

    if (!currentUser) {
      return NextResponse.json(
        { success: false, error: "未登录" },
        { status: 401 }
      );
    }

    if (currentUser.role !== "admin") {
      return NextResponse.json(
        { success: false, error: "权限不足" },
        { status: 403 }
      );
    }

    const users = await getUserList();

    return NextResponse.json({
      success: true,
      data: users,
    });
  } catch (error) {
    console.error("获取用户列表失败:", error);
    return NextResponse.json(
      { success: false, error: "获取用户列表失败" },
      { status: 500 }
    );
  }
}

// 创建用户
export async function POST(request: NextRequest) {
  try {
    const currentUser = await getCurrentUser();

    if (!currentUser) {
      return NextResponse.json(
        { success: false, error: "未登录" },
        { status: 401 }
      );
    }

    if (currentUser.role !== "admin") {
      return NextResponse.json(
        { success: false, error: "权限不足" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { username, password, role = "user" } = body;

    if (!username || !password) {
      return NextResponse.json(
        { success: false, error: "用户名和密码不能为空" },
        { status: 400 }
      );
    }

    if (username.length < 3 || username.length > 50) {
      return NextResponse.json(
        { success: false, error: "用户名长度应在3-50个字符之间" },
        { status: 400 }
      );
    }

    if (password.length < 4) {
      return NextResponse.json(
        { success: false, error: "密码长度至少4个字符" },
        { status: 400 }
      );
    }

    const result = await createUser(username, password, role);

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      user: result.user,
    });
  } catch (error) {
    console.error("创建用户失败:", error);
    return NextResponse.json(
      { success: false, error: "创建用户失败" },
      { status: 500 }
    );
  }
}

// 更新用户
export async function PATCH(request: NextRequest) {
  try {
    const currentUser = await getCurrentUser();

    if (!currentUser) {
      return NextResponse.json(
        { success: false, error: "未登录" },
        { status: 401 }
      );
    }

    if (currentUser.role !== "admin") {
      return NextResponse.json(
        { success: false, error: "权限不足" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { userId, action, value } = body;

    if (!userId || !action) {
      return NextResponse.json(
        { success: false, error: "参数错误" },
        { status: 400 }
      );
    }

    let result;

    switch (action) {
      case "updateStatus":
        result = await updateUserStatus(userId, value);
        break;
      case "updatePassword":
        if (!value || value.length < 4) {
          return NextResponse.json(
            { success: false, error: "密码长度至少4个字符" },
            { status: 400 }
          );
        }
        result = await updateUserPassword(userId, value);
        break;
      default:
        return NextResponse.json(
          { success: false, error: "未知操作" },
          { status: 400 }
        );
    }

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("更新用户失败:", error);
    return NextResponse.json(
      { success: false, error: "更新用户失败" },
      { status: 500 }
    );
  }
}

// 删除用户
export async function DELETE(request: NextRequest) {
  try {
    const currentUser = await getCurrentUser();

    if (!currentUser) {
      return NextResponse.json(
        { success: false, error: "未登录" },
        { status: 401 }
      );
    }

    if (currentUser.role !== "admin") {
      return NextResponse.json(
        { success: false, error: "权限不足" },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("id");

    if (!userId) {
      return NextResponse.json(
        { success: false, error: "用户ID不能为空" },
        { status: 400 }
      );
    }

    // 不能删除自己
    if (parseInt(userId) === currentUser.id) {
      return NextResponse.json(
        { success: false, error: "不能删除当前登录的账号" },
        { status: 400 }
      );
    }

    const result = await deleteUser(parseInt(userId));

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("删除用户失败:", error);
    return NextResponse.json(
      { success: false, error: "删除用户失败" },
      { status: 500 }
    );
  }
}
