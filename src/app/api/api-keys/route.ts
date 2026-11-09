import { requireSiteAuth } from '@/lib/auth-gate';
import { getCurrentUser } from '@/lib/auth';
import { ApiKeyError, createApiKey, listApiKeys } from '@/lib/api-keys';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const authError = await requireSiteAuth();
  if (authError) return authError;
  try {
    const user = await getCurrentUser();
    if (!user) return Response.json({ error: '未登录' }, { status: 401 });
    return Response.json({ keys: await listApiKeys(user, new URL(request.url).searchParams.get('all') === '1') });
  } catch (error) {
    return Response.json({ error: error instanceof ApiKeyError ? error.message : '获取API Key失败' }, { status: error instanceof ApiKeyError ? error.status : 500 });
  }
}

export async function POST(request: Request) {
  const authError = await requireSiteAuth();
  if (authError) return authError;
  try {
    const user = await getCurrentUser();
    if (!user) return Response.json({ error: '未登录' }, { status: 401 });
    let body;
    try { body = await request.json(); } catch { throw new ApiKeyError('无效的JSON'); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ApiKeyError('参数错误');
    return Response.json(await createApiKey({ userId: user.id, name: body.name, expiresInDays: body.expires_in_days }), { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof ApiKeyError ? error.message : '创建API Key失败' }, { status: error instanceof ApiKeyError ? error.status : 500 });
  }
}
