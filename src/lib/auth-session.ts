import { verifyToken } from './jwt';

/** JWT identifies the account; the database remains the authority for status/role. */
export async function resolveSession<T extends { is_active: boolean }>(
  token: string | undefined,
  findUser: (userId: number) => Promise<T | null | undefined>,
): Promise<T | null> {
  if (!token) return null;
  const payload = verifyToken(token);
  if (!payload) return null;
  const user = await findUser(payload.userId);
  return user?.is_active ? user : null;
}
