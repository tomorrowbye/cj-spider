import { NextRequest } from 'next/server';

/**
 * 从请求中获取原站登录 Cookie
 */
export function getCjCookies(request: NextRequest): string | null {
  const cjAuth = request.cookies.get('cj_auth')?.value;
  if (!cjAuth) {
    return null;
  }
  return decodeURIComponent(cjAuth);
}
