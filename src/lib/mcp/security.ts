/** One limiter per API key; denied calls do not consume narrower buckets. */
export function createRateLimiter(clock = Date.now) {
  const buckets = new Map<string, { tokens: number; at: number }>();
  return (tool: string) => {
    const now = clock();
    const limits: [string, number][] = [['all', 60]];
    if (tool === 'get_captcha' || tool === 'submit_captcha') limits.push(['captcha', 10]);
    if (tool === 'start_crawl') limits.push(['start', 3]);
    const current = limits.map(([key, capacity]) => {
      const previous = buckets.get(key) ?? { tokens: capacity, at: now };
      return { key, tokens: Math.min(capacity, previous.tokens + Math.max(0, now - previous.at) * capacity / 60_000), at: now };
    });
    if (current.some(b => b.tokens < 1)) return false;
    for (const b of current) buckets.set(b.key, { tokens: b.tokens - 1, at: now });
    return true;
  };
}
export function createFailedAuthLimiter(clock = Date.now) {
  const failures = new Map<string, { count: number; at: number }>();
  return {
    blocked(ip: string) {
      const entry = failures.get(ip);
      return !!entry && clock() - entry.at < 60_000 && entry.count >= 20;
    },
    record(ip: string) {
      const now = clock();
      for (const [key, value] of failures) if (now - value.at >= 60_000) failures.delete(key);
      const entry = failures.get(ip) ?? { count: 0, at: now };
      entry.count++; failures.set(ip, entry);
    },
  };
}
const allowed: Record<string, string[]> = {
  start_crawl: ['pages', 'start_page', 'end_page', 'skip_existing'],
  get_crawl_status: ['task_id'], pause_crawl: ['task_id'], resume_crawl: ['task_id'], cancel_crawl: ['task_id'],
  list_recent_news: ['limit', 'start_date', 'end_date'],
};
export function redactArgs(tool: string, args: Record<string, unknown>): Record<string, unknown> {
  if (tool === 'create_user') return {
    ...(typeof args.username === 'string' && args.username.length <= 50 ? { username: args.username } : {}),
    role: args.role === 'admin' ? 'admin' : 'user',
    password_source: args.password === undefined ? 'generated' : 'provided',
  };
  if (tool === 'submit_captcha') return { code_length: typeof args.code === 'string' ? args.code.length : 0 };
  return Object.fromEntries((allowed[tool] ?? []).filter(key => {
    const value = args[key];
    if (key === 'skip_existing') return typeof value === 'boolean';
    if (['pages', 'start_page', 'end_page', 'limit'].includes(key)) return typeof value === 'number' && Number.isSafeInteger(value);
    if (key === 'task_id') return typeof value === 'string' && /^[1-9]\d{0,15}$/.test(value);
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
  }).map(key => [key, args[key]]));
}
