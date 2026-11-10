import { requireSiteAuth } from '@/lib/auth-gate';
import { getCurrentUser } from '@/lib/auth';
import { ApiKeyError, revokeApiKey } from '@/lib/api-keys';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const authError = await requireSiteAuth();
  if (authError) return authError;
  try {
    const user = await getCurrentUser();
    if (!user) return Response.json({ error: '未登录' }, { status: 401 });
    const { id } = await context.params;
    if (!/^[1-9]\d*$/.test(id)) throw new ApiKeyError('无效的Key ID');
    await revokeApiKey(Number(id), user);
    return Response.json({ success: true });
  } catch (error) {
    return Response.json({ error: error instanceof ApiKeyError ? error.message : '吊销API Key失败' }, { status: error instanceof ApiKeyError ? error.status : 500 });
  }
}
