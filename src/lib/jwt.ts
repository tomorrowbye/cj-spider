import jwt from 'jsonwebtoken';
import { getJwtSecret } from './server-env';

export interface JwtPayload {
  userId: number;
  username: string;
  role: string;
  iat?: number;
  exp?: number;
}

export function generateToken(user: { id: number; username: string; role: string }): string {
  return jwt.sign({ userId: user.id, username: user.username, role: user.role }, getJwtSecret(), {
    algorithm: 'HS256', expiresIn: '7d',
  });
}

export function verifyToken(token: string): JwtPayload | null {
  const secret = getJwtSecret();
  try {
    const payload = jwt.verify(token, secret, { algorithms: ['HS256'] });
    if (typeof payload === 'string' || !Number.isSafeInteger(payload.userId) || payload.userId <= 0 ||
        typeof payload.exp !== 'number' || typeof payload.username !== 'string' || typeof payload.role !== 'string') return null;
    return payload as JwtPayload;
  } catch {
    return null;
  }
}
