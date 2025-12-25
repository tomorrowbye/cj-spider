import { NextResponse } from "next/server";
import { getCaptcha } from "@/lib/cj-auth";
import { generateSessionId, saveSession } from "@/lib/session-store";

export async function GET() {
  try {
    const { imageBuffer, cookies } = await getCaptcha();

    // 生成会话 ID 并保存原站 Cookie
    const sessionId = generateSessionId();
    const cjCookieString = cookies.map((c) => c.split(";")[0]).join("; ");
    saveSession(sessionId, cjCookieString);

    const response = new NextResponse(new Uint8Array(imageBuffer), {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-store",
      },
    });

    // 设置我们自己的会话 Cookie，用于关联原站 Cookie
    response.headers.append(
      "Set-Cookie",
      `cj_session=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=300`,
    );

    return response;
  } catch (error) {
    console.error("获取验证码失败:", error);
    return NextResponse.json({ error: "获取验证码失败" }, { status: 500 });
  }
}
