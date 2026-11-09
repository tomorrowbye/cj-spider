import 'server-only';
import { randomBytes } from 'node:crypto';
import { authenticateApiKey } from '../api-keys';
import { createUserValidated } from '../auth';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult, type Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { Kysely } from 'kysely';
import { getDb, type Database } from '../db';
import { createCrawlController, getCrawlController } from '../crawl/task-manager';
import type { CrawlProgress } from '../crawl/types';
import * as cjAuth from '../cj-auth';
import { getCurrentCjSession, invalidateCjSession, saveCjSession } from '../cj-session-repository';
import { consumeMcpCaptchaSession, createMcpCaptchaSession } from '../session-store';
import { createFailedAuthLimiter, createRateLimiter, redactArgs } from './security';
import { latestTaskId, recentNews, writeAudit } from './repository';
import { createUserSchema, emptySchema, newsSchema, startSchema, submitSchema, taskSchema } from './schemas';
import { version } from '../../../package.json';

const definitions = {
  create_user: { description: '仅管理员：创建站内账号，可指定角色；省略密码时生成强随机密码且仅在本次结果返回。', schema: createUserSchema },
  start_crawl: { description: '开始爬取最新页数或指定范围，未登录时保存任务并提示验证码；最多 100 页，支持幂等键。', schema: startSchema },
  get_crawl_status: { description: '查询任务进度、暂停原因和最近十条文章；不传任务编号时查询最近任务。', schema: taskSchema },
  get_captcha: { description: '获取原站登录验证码图片及五分钟有效的一次性登录会话。', schema: emptySchema },
  submit_captcha: { description: '提交人工识别的验证码，验证原站登录并自动继续因登录失效暂停的任务。', schema: submitSchema },
  pause_crawl: { description: '暂停指定任务；省略任务编号时暂停当前活动任务。', schema: taskSchema },
  resume_crawl: { description: '验证原站登录并继续指定或当前任务；失效时提示获取验证码。', schema: taskSchema },
  cancel_crawl: { description: '取消指定或当前任务，保留已入库文章。', schema: taskSchema },
  list_recent_news: { description: '按北京时间日期和关键词查询最近文章，仅返回摘要字段和原文链接，不含正文。', schema: newsSchema },
};
type ToolName = keyof typeof definitions;
export interface McpDependencies {
  db?: Kysely<Database>;
  controller?: ReturnType<typeof createCrawlController>;
  upstream?: Pick<typeof cjAuth, 'getCaptcha' | 'login' | 'checkLoginStatus'>;
  env?: Partial<Record<'CJ_USERNAME' | 'CJ_PASSWORD', string>>;
  clock?: () => number;
  log?: (line: string) => void;
}
export function beijingTime(value: Date | string | null): string | null {
  if (value === null) return null;
  return new Date(new Date(value).getTime() + 8 * 60 * 60 * 1000).toISOString().replace('Z', '+08:00');
}
function status(p: CrawlProgress) {
  return { task_id: p.sessionId, state: p.status, phase: p.phase, current_page: p.currentPage,
    total_pages: p.totalPages, total_news: p.totalNews, crawled: p.crawledNews, failed: p.failedNews,
    pending: p.pendingNews, avg_speed: p.avgSpeed, eta_minutes: p.estimatedTime,
    needs_captcha: p.pauseReason === 'cj_login_required', pause_reason: p.pauseReason,
    recent_titles: p.recentTitles.slice(-10).map(t => ({ ...t, time: beijingTime(t.time) })),
    started_at: beijingTime(p.startedAt), finished_at: beijingTime(p.finishedAt) };
}
function result(value: Record<string, unknown>, isError = false): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value, ...(isError ? { isError: true } : {}) };
}
function mergeCookies(...sets: string[][]) {
  const pairs = new Map<string, string>();
  for (const cookie of sets.flat()) {
    const pair = cookie.split(';')[0].trim(); const equal = pair.indexOf('=');
    if (equal > 0) pairs.set(pair.slice(0, equal), pair);
  }
  return [...pairs.values()].join('; ');
}
function cookieExpiry(cookies: string[]) {
  let expiry = Date.now() + 86400000;
  for (const cookie of cookies) {
    const maxAge = /;\s*max-age=(-?\d+)/i.exec(cookie);
    const expires = /;\s*expires=([^;]+)/i.exec(cookie);
    const value = maxAge ? Date.now() + Number(maxAge[1]) * 1000 : expires ? Date.parse(expires[1]) : NaN;
    if (Number.isFinite(value)) expiry = Math.min(expiry, value);
  }
  return new Date(expiry);
}

/** Stateless protocol server/transport per request, shared tool rate buckets per bearer. */
export function createMcpHandler(deps: McpDependencies = {}) {
  const limiters = new Map<number, { take: ReturnType<typeof createRateLimiter>; at: number }>();
  const failedAuth = createFailedAuthLimiter(deps.clock);
  return async (request: Request): Promise<Response> => {
    const env = deps.env ?? process.env;
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() || request.headers.get('x-real-ip') || 'unknown';
    if (failedAuth.blocked(ip)) return Response.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': '60' } });
    const db = deps.db ?? getDb();
    let identity: Awaited<ReturnType<typeof authenticateApiKey>>;
    try { identity = await authenticateApiKey(request.headers.get('authorization'), db); }
    catch { return Response.json({ error: 'MCP unavailable' }, { status: 503 }); }
    if (!identity) {
      failedAuth.record(ip);
      return Response.json({ error: 'Unauthorized' }, { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } });
    }
    const { user, apiKey } = identity;
    const controller = deps.controller ?? (deps.db ? createCrawlController({ db }) : getCrawlController());
    const upstream = deps.upstream ?? cjAuth;
    const now = (deps.clock ?? Date.now)();
    for (const [key, value] of limiters) if (now - value.at >= 60_000) limiters.delete(key);
    const bucket = limiters.get(apiKey.id) ?? { take: createRateLimiter(deps.clock), at: now };
    bucket.at = now; limiters.set(apiKey.id, bucket);
    const take = bucket.take;
    const server = new Server({ name: 'cj-spider', version }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: Object.entries(definitions).map(([name, d]) => ({ name, description: d.description, inputSchema: z.toJSONSchema(d.schema, { io: 'input' }) as Tool['inputSchema'] })) }));
    async function validCookie() {
      const session = await getCurrentCjSession(db);
      if (!session) return null;
      let valid = false;
      try { valid = await upstream.checkLoginStatus(session.cookies!); } catch { /* fail closed */ }
      if (valid) return session.cookies;
      await invalidateCjSession(session.id, db); return null;
    }
    async function execute(name: ToolName, raw: Record<string, unknown>): Promise<CallToolResult> {
      if (name === 'create_user') {
        const args = createUserSchema.parse(raw);
        const generated = args.password === undefined ? randomBytes(24).toString('base64url') : undefined;
        const created = await createUserValidated({ ...args, password: args.password ?? generated }, db);
        if (!created.success || !created.user) return result({ error: created.error ?? '创建用户失败' }, true);
        return result({ user_id: created.user.id, username: created.user.username, role: created.user.role,
          ...(generated ? { generated_password: generated } : {}) });
      }
      if (name === 'start_crawl') {
        const args = startSchema.parse(raw);
        await validCookie();
        const p = await controller.start({ startPage: args.start_page ?? 1, endPage: args.end_page ?? args.pages!, skipExisting: args.skip_existing, idempotencyKey: args.idempotency_key });
        return result({ task_id: p.sessionId, status: p.status, start_page: p.startPage, end_page: p.endPage, needs_captcha: p.pauseReason === 'cj_login_required', ...(p.already_running ? { already_running: true } : {}) });
      }
      if (name === 'get_crawl_status') {
        const args = taskSchema.parse(raw);
        await controller.recover();
        const id = args.task_id ?? await latestTaskId(db);
        const p = id ? await controller.getStatus(id) : null;
        return p ? result(status(p)) : result({ error: '没有找到任务' }, true);
      }
      if (name === 'get_captcha' || name === 'submit_captcha') {
        if (!env.CJ_USERNAME || !env.CJ_PASSWORD) return result({ error: '未配置 CJ_USERNAME 和 CJ_PASSWORD，无法登录原站' }, true);
        if (name === 'get_captcha') {
          const captcha = await upstream.getCaptcha();
          if (!captcha.mimeType.startsWith('image/')) return result({ error: '验证码图片暂不可用，请重新获取验证码' }, true);
          const id = createMcpCaptchaSession(user!.id, mergeCookies(captcha.cookies));
          const response = result({ login_session_id: id, expires_in_seconds: 300, hint: '请识别图片并在五分钟内提交验证码；失败后请重新获取。' });
          response.content.unshift({ type: 'image', data: captcha.imageBuffer.toString('base64'), mimeType: captcha.mimeType });
          return response;
        }
        const args = submitSchema.parse(raw);
        const cookie = consumeMcpCaptchaSession(user!.id, args.login_session_id);
        const failed = () => result({ logged_in: false, error: '登录失败或验证码已过期，请重新获取验证码' });
        if (!cookie) return failed();
        try {
          const loggedIn = await upstream.login({ username: env.CJ_USERNAME, password: env.CJ_PASSWORD, code: args.code, cookie });
          if (!loggedIn.success) return failed();
          const merged = mergeCookies(cookie.split('; '), loggedIn.cookies ?? []);
          if (!await upstream.checkLoginStatus(merged)) return failed();
          await saveCjSession(merged, cookieExpiry(loggedIn.cookies ?? []), db);
          const active = await controller.getCurrent();
          let resumed: string | undefined;
          if (active?.pauseReason === 'cj_login_required' && await controller.resume(active.sessionId)) resumed = active.sessionId;
          return result({ logged_in: true, ...(resumed ? { resumed_task_id: resumed } : {}) });
        } catch { return failed(); }
      }
      if (name === 'list_recent_news') {
        const args = newsSchema.parse(raw);
        const news = await recentNews({ pageSize: args.limit, startDate: args.start_date, endDate: args.end_date, keyword: args.keyword }, db);
        const items = news.map(row => ({ ...row, publish_time: beijingTime(row.publish_time) }));
        // MCP structuredContent must be an object; text preserves the specified array result.
        return { content: [{ type: 'text', text: JSON.stringify(items) }], structuredContent: { news: items } };
      }
      const args = taskSchema.parse(raw);
      const id = args.task_id ?? (await controller.getCurrent())?.sessionId;
      if (!id) return result({ error: '没有活动任务' }, true);
      if (name === 'resume_crawl') {
        const current = await controller.getStatus(id);
        if (!current || current.status !== 'paused') return result({ error: '任务当前无法继续' }, true);
        if (current.phase === 'list' && !await validCookie()) {
          // Record the explicit resume intent so successful captcha submission can continue it.
          await controller.resume(id);
          const p = await controller.getStatus(id);
          return p ? result({ ...status(p), needs_captcha: true }) : result({ error: '没有找到任务' }, true);
        }
        if (!await controller.resume(id)) return result({ error: '任务当前无法继续' }, true);
      } else if (!await controller[name === 'pause_crawl' ? 'pause' : 'cancel'](id)) return result({ error: '任务当前无法执行此操作' }, true);
      const p = await controller.getStatus(id);
      return p ? result(status(p)) : result({ error: '没有找到任务' }, true);
    }
    server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
      const started = Date.now();
      const raw = params.arguments ?? {};
      const known = Object.hasOwn(definitions, params.name);
      const tool = known ? params.name : 'unknown_tool';
      let response: CallToolResult;
      try {
        if (!take(tool)) response = result({ error: '调用过于频繁，请稍后重试' }, true);
        else if (tool === 'create_user' && user.role !== 'admin') response = result({ error: 'forbidden: admin only' }, true);
        else if (!known) response = result({ error: '未知工具' }, true);
        else if (!definitions[params.name as ToolName].schema.safeParse(raw).success) response = result({ error: '参数无效，请检查工具输入格式和范围' }, true);
        else response = await execute(params.name as ToolName, raw);
      } catch { response = result({ error: '工具执行失败，请稍后重试；登录失败时请重新获取验证码' }, true); }
      const output = response.structuredContent ?? {};
      const ok = !response.isError && output.logged_in !== false;
      const task = output.task_id ?? output.resumed_task_id ?? raw.task_id;
      const taskId = typeof task === 'string' && /^[1-9]\d*$/.test(task) && Number.isSafeInteger(Number(task)) ? Number(task) : null;
      const duration = Date.now() - started;
      try {
        await writeAudit(db, { user_id: user.id, api_key_id: apiKey.id, tool, args_redacted: redactArgs(tool, raw), ok, error: ok ? null : tool === 'create_user' && user.role !== 'admin' ? 'forbidden: admin only' : 'Tool call failed', duration_ms: duration, task_id: taskId });
      } catch { response = result({ error: '审计记录暂不可用，请稍后重试' }, true); }
      (deps.log ?? console.log)(JSON.stringify({ tool, user_id: user.id, api_key_id: apiKey.id, key_prefix: apiKey.key_prefix, ok: ok && !response.isError, duration_ms: duration, task_id: taskId }));
      return response;
    });
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    try {
      await server.connect(transport);
      return await transport.handleRequest(request);
    } finally { await server.close(); }
  };
}
