import { NextResponse } from "next/server";
import { getCookieName } from "@/lib/auth";

export async function POST() {
  const response = NextResponse.json({ success: true });

  // 清除 Cookie
  response.cookies.set(getCookieName(), "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  });

  return response;
}
