// 简单的内存会话存储（生产环境应使用 Redis）
// 用于存储验证码请求时获取的原站 Cookie

interface SessionData {
  cjCookies: string;
  createdAt: number;
}

const sessionStore = new Map<string, SessionData>();

// 会话过期时间：5分钟
const SESSION_TTL = 5 * 60 * 1000;

/**
 * 生成会话 ID
 */
export function generateSessionId(): string {
  return `sess_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
}

/**
 * 保存会话数据
 */
export function saveSession(sessionId: string, cjCookies: string): void {
  // 清理过期会话
  cleanExpiredSessions();

  sessionStore.set(sessionId, {
    cjCookies,
    createdAt: Date.now(),
  });
}

/**
 * 获取会话数据
 */
export function getSession(sessionId: string): string | null {
  const session = sessionStore.get(sessionId);

  if (!session) {
    return null;
  }

  // 检查是否过期
  if (Date.now() - session.createdAt > SESSION_TTL) {
    sessionStore.delete(sessionId);
    return null;
  }

  return session.cjCookies;
}

/**
 * 删除会话
 */
export function deleteSession(sessionId: string): void {
  sessionStore.delete(sessionId);
}

/**
 * 清理过期会话
 */
function cleanExpiredSessions(): void {
  const now = Date.now();
  for (const [id, session] of sessionStore.entries()) {
    if (now - session.createdAt > SESSION_TTL) {
      sessionStore.delete(id);
    }
  }
}
