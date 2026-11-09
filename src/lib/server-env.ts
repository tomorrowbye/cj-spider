type ServerEnv = { [key: string]: string | undefined; JWT_SECRET?: string; DATABASE_URL?: string };

/** Read at runtime, never at module evaluation (Next builds need no secrets). */
export function getJwtSecret(env: ServerEnv = process.env): string {
  if (!env.JWT_SECRET?.trim()) throw new Error('JWT_SECRET is required');
  return env.JWT_SECRET;
}

export function validateRuntimeEnv(env: ServerEnv = process.env): void {
  getJwtSecret(env);
  if (!env.DATABASE_URL?.trim()) throw new Error('DATABASE_URL is required');
}
