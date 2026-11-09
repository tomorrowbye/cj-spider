type AuthUser = { role: string; is_active: boolean };

export async function authorizeApi(user: AuthUser | null, admin = false): Promise<Response | null> {
  if (!user?.is_active) return Response.json({ success: false, error: '未登录' }, { status: 401 });
  if (admin && user.role !== 'admin') return Response.json({ success: false, error: '权限不足' }, { status: 403 });
  return null;
}

export async function requireSiteAuth(admin = false): Promise<Response | null> {
  const { getCurrentUser } = await import('./auth');
  return authorizeApi(await getCurrentUser(), admin);
}
