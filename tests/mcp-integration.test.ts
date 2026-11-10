import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Kysely, PGliteDialect } from 'kysely';
import { PGlite } from '@electric-sql/pglite';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { migrate } from '../db/migrate';
import type { Database } from '../src/lib/db';
import { createCrawlController } from '../src/lib/crawl/task-manager';
import { createMcpHandler } from '../src/lib/mcp/handler';
import { getCurrentCjSession, saveCjSession } from '../src/lib/cj-session-repository';
import { getSession, saveSession } from '../src/lib/session-store';
import { createApiKey } from '../src/lib/api-keys';

const env = { CJ_USERNAME: 'fake-upstream-user', CJ_PASSWORD: 'fake-upstream-password' };
async function fixture() {
  const db = new Kysely<Database>({ dialect: new PGliteDialect({ pglite: new PGlite() }) });
  await migrate(db);
  const user = await db.insertInto('site_users').values({ username: 'mcp-test', password_hash: 'unused' }).returningAll().executeTakeFirstOrThrow();
  const apiKey = await createApiKey({ userId: user.id, name: 'SDK test' }, db);
  return { db, user, apiKey, auth: { Authorization: `Bearer ${apiKey.key}` } };
}
function clientFor(handler: (r: Request) => Promise<Response>, headers: Record<string, string>) {
  const client = new Client({ name: 'fake-sdk-test', version: '1' });
  const transport = new StreamableHTTPClientTransport(new URL('http://mcp.test/api/mcp'), {
    requestInit: { headers }, fetch: (input, init) => handler(new Request(input, init)),
  });
  return { client, transport };
}
function output(value: Awaited<ReturnType<Client['callTool']>>) { return value.structuredContent as Record<string, unknown>; }

test('real SDK: full captcha flow, persisted reservation, schema enforcement, latest completed task and sanitized audits', async () => {
  const { db, auth } = await fixture(); const logs: string[] = []; const seenCookies: string[] = [];
  let loginCalls = 0;
  const controller = createCrawlController({ db, delay: async () => {}, getListPage: async page => ({ page, total: 0, articles: [] }) });
  const handler = createMcpHandler({ db, controller, env, log: line => logs.push(line), upstream: {
    getCaptcha: async () => ({ imageBuffer: Buffer.from('fake-image'), mimeType: 'image/gif', cookies: ['captcha=secret-captcha; Path=/'] }),
    login: async params => { loginCalls++; assert.equal(params.cookie, 'captcha=secret-captcha'); return { success: true, cookies: ['auth=secret-auth; Path=/; Max-Age=3600'] }; },
    checkLoginStatus: async cookie => { seenCookies.push(cookie); return cookie.includes('auth=secret-auth') && cookie.includes('captcha=secret-captcha'); },
  } });
  const { client, transport } = clientFor(handler, auth);
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map(t => t.name).sort(), ['create_user','start_crawl','get_crawl_status','get_captcha','submit_captcha','pause_crawl','resume_crawl','cancel_crawl','list_recent_news','export_news','export_crawl_history','list_export_history'].sort());
    assert.ok(tools.every(t => /[\u4e00-\u9fff]/.test(t.description ?? '')));
    const bad = await client.callTool({ name: 'start_crawl', arguments: { pages: 2, start_page: 1, end_page: 2, password: 'do-not-log' } });
    assert.equal(bad.isError, true);
    const started = output(await client.callTool({ name: 'start_crawl', arguments: { pages: 2, idempotency_key: 'fake-key' } }));
    assert.equal(started.needs_captcha, true); assert.equal(started.start_page, 1); assert.equal(started.end_page, 2);
    const duplicate = output(await client.callTool({ name: 'start_crawl', arguments: { pages: 3 } }));
    assert.equal(duplicate.task_id, started.task_id); assert.equal(duplicate.already_running, true);
    const captcha = await client.callTool({ name: 'get_captcha', arguments: {} });
    assert.ok(Array.isArray(captcha.content));
    const image = (captcha.content as { type: string; mimeType?: string; data?: string }[]).find(c => c.type === 'image')!;
    assert.equal(image.mimeType, 'image/gif'); assert.equal(image.data, Buffer.from('fake-image').toString('base64'));
    const id = output(captcha).login_session_id as string;
    assert.equal(getSession(id), null);
    const loggedIn = output(await client.callTool({ name: 'submit_captcha', arguments: { code: '1234', login_session_id: id } }));
    assert.equal(loggedIn.logged_in, true); assert.equal(loggedIn.resumed_task_id, started.task_id);
    assert.equal(transport.sessionId, undefined);
    await controller.waitForIdle();
    const status = output(await client.callTool({ name: 'get_crawl_status', arguments: {} }));
    assert.equal(status.task_id, started.task_id); assert.equal(status.state, 'completed'); assert.equal(status.current_page, 2);
    assert.match(status.started_at as string, /\+08:00$/); assert.match(status.finished_at as string, /\+08:00$/);
    assert.equal(output(await client.callTool({ name: 'submit_captcha', arguments: { code: '1234', login_session_id: id } })).logged_in, false);
    assert.equal(loginCalls, 1); assert.equal(seenCookies[0], 'captcha=secret-captcha; auth=secret-auth');
    const session = await getCurrentCjSession(db); assert.ok(session); assert.ok(new Date(session.expires_at!).getTime() <= Date.now() + 3600000);
    const audits = await db.selectFrom('mcp_audit_log').selectAll().execute();
    assert.equal(audits.length, 7);
    const submitted = audits.filter(a => a.tool === 'submit_captcha');
    assert.deepEqual(submitted[0].args_redacted, { code_length: 4 }); assert.equal(submitted[1].ok, false);
    assert.doesNotMatch(JSON.stringify(audits) + logs.join(''), /secret-auth|secret-captcha|1234|do-not-log|fake-upstream-password|fake-mcp-integration-token/);
    assert.ok(logs.every(l => Object.hasOwn(JSON.parse(l), 'duration_ms')));
    const get = await handler(new Request('http://mcp.test/api/mcp', { method: 'GET', headers: { ...auth, Accept: 'text/event-stream' } }));
    assert.equal(get.status, 200);
    assert.match(get.headers.get('content-type') ?? '', /text\/event-stream/);
    await get.body?.cancel();
    const del = await handler(new Request('http://mcp.test/api/mcp', { method: 'DELETE', headers: auth })); assert.equal(del.status, 200);
  } finally { await client.close(); await controller.waitForIdle(); await db.destroy(); }
});

for (const state of ['completed', 'failed', 'cancelled'] as const) {
  test(`real SDK start_crawl reports ${state} idempotent replay without already_running`, async () => {
    const { db, auth } = await fixture();
    const controller = createCrawlController({ db });
    const handler = createMcpHandler({ db, controller, env, log: () => {} });
    const { client, transport } = clientFor(handler, auth);
    try {
      await client.connect(transport);
      const args = { pages: 1, idempotency_key: 'ended-key' };
      const started = output(await client.callTool({ name: 'start_crawl', arguments: args }));
      const active = output(await client.callTool({ name: 'start_crawl', arguments: args }));
      assert.equal(active.task_id, started.task_id);
      assert.equal(active.already_running, true);
      await db.updateTable('crawl_sessions').set({ status: state, finished_at: new Date() }).where('id', '=', Number(started.task_id)).execute();
      const replay = output(await client.callTool({ name: 'start_crawl', arguments: args }));
      assert.equal(replay.task_id, started.task_id);
      assert.equal(replay.status, state);
      assert.equal(replay.already_running, undefined);
      assert.equal(replay.idempotent_replay, true);
      assert.equal((await db.selectFrom('crawl_sessions').select('id').execute()).length, 1);
    } finally { await client.close(); await controller.waitForIdle(); await db.destroy(); }
  });
}

test('real SDK rejects missing bearer and looks up active user on every request without cookies', async () => {
  const { db, auth } = await fixture();
  const handler = createMcpHandler({ db, env, log: () => {} });
  try {
    assert.equal((await createMcpHandler({ db, env: {} })(new Request('http://mcp.test'))).status, 401);
    const denied = await handler(new Request('http://mcp.test', { headers: { Cookie: 'site_auth=fake; cj_auth=fake' } }));
    assert.equal(denied.status, 401); assert.equal(denied.headers.get('www-authenticate'), 'Bearer'); assert.equal(denied.headers.get('set-cookie'), null);
    const { client, transport } = clientFor(handler, {} as typeof auth);
    await assert.rejects(client.connect(transport)); await client.close();
    const good = clientFor(handler, auth); await good.client.connect(good.transport);
    await db.updateTable('site_users').set({ is_active: false }).execute();
    await assert.rejects(good.client.listTools());
    await good.client.close();
    await db.deleteFrom('site_users').execute();
    assert.equal((await handler(new Request('http://mcp.test', { headers: auth }))).status, 401);
  } finally { await db.destroy(); }
});

test('SDK recovers midcrawl expiry at exact page and resume rejects invalid persisted login', async () => {
  const { db, auth } = await fixture(); const pages: number[] = []; let reject = true; let loginValid = true;
  await saveCjSession('old=secret', new Date(Date.now() + 60_000), db);
  const controller = createCrawlController({ db, delay: async () => {}, getListPage: async page => {
    pages.push(page); return page === 12 && reject ? null : { page, total: 0, articles: [] };
  } });
  const handler = createMcpHandler({ db, controller, env, log: () => {}, upstream: {
    getCaptcha: async () => ({ imageBuffer: Buffer.from('image'), mimeType: 'image/png', cookies: ['captcha=fake'] }),
    login: async () => ({ success: true, cookies: ['auth=fresh'] }),
    checkLoginStatus: async () => loginValid,
  } });
  const { client, transport } = clientFor(handler, auth);
  try {
    await client.connect(transport);
    const started = output(await client.callTool({ name: 'start_crawl', arguments: { start_page: 11, end_page: 13 } }));
    await controller.waitForIdle();
    let current = output(await client.callTool({ name: 'get_crawl_status', arguments: {} }));
    assert.equal(current.state, 'paused'); assert.equal(current.pause_reason, 'cj_login_required'); assert.equal(current.current_page, 1);
    assert.equal(await getCurrentCjSession(db), null);
    await saveCjSession('invalid=secret', new Date(Date.now() + 60_000), db); loginValid = false;
    const resumed = output(await client.callTool({ name: 'resume_crawl', arguments: {} }));
    assert.equal(resumed.needs_captcha, true); assert.equal(await getCurrentCjSession(db), null);
    const cap = output(await client.callTool({ name: 'get_captcha', arguments: {} }));
    reject = false; loginValid = true;
    assert.equal(output(await client.callTool({ name: 'submit_captcha', arguments: { code: '5678', login_session_id: cap.login_session_id } })).resumed_task_id, started.task_id);
    await controller.waitForIdle();
    current = output(await client.callTool({ name: 'get_crawl_status', arguments: {} }));
    assert.equal(current.state, 'completed'); assert.deepEqual(pages, [11, 12, 12, 13]);
  } finally { await client.close(); await controller.waitForIdle(); await db.destroy(); }
});

test('SDK tool failures hide upstream secrets, reject browser captcha sessions, and require configured credentials', async () => {
  const { db, auth } = await fixture(); let loginCalls = 0;
  const handler = createMcpHandler({ db, env, log: () => {}, upstream: {
    getCaptcha: async () => { throw Error('password=secret cookie=secret'); },
    login: async () => { loginCalls++; throw Error('password=secret'); }, checkLoginStatus: async () => false,
  } });
  const { client, transport } = clientFor(handler, auth);
  try {
    await client.connect(transport);
    const failure = await client.callTool({ name: 'get_captcha', arguments: {} });
    assert.equal(failure.isError, true); assert.doesNotMatch(JSON.stringify(failure), /secret/);
    saveSession('web-session', 'browser-secret');
    assert.equal(output(await client.callTool({ name: 'submit_captcha', arguments: { code: '1234', login_session_id: 'web-session' } })).logged_in, false);
    assert.equal(loginCalls, 0); assert.equal(getSession('web-session'), 'browser-secret');
    const disabled = clientFor(createMcpHandler({ db, env: {}, log: () => {} }), auth);
    await disabled.client.connect(disabled.transport);
    const missing = await disabled.client.callTool({ name: 'get_captcha', arguments: {} });
    assert.equal(missing.isError, true); assert.match(JSON.stringify(missing), /CJ_USERNAME/);
    await disabled.client.close();
  } finally { await client.close(); await db.destroy(); }
});

test('SDK rates persist across stateless requests, audit denied calls, project news and preserve manual pauses', async () => {
  const { db, auth } = await fixture(); let now = 0;
  const controller = createCrawlController({ db });
  const handler = createMcpHandler({ db, controller, env, clock: () => now, log: () => {}, upstream: {
    getCaptcha: async () => ({ imageBuffer: Buffer.from('image'), mimeType: 'image/jpeg', cookies: ['captcha=fake'] }),
    login: async () => ({ success: true, cookies: ['auth=fake'] }), checkLoginStatus: async () => true,
  } });
  const { client, transport } = clientFor(handler, auth);
  try {
    await db.insertInto('news').values({ source_id: 'projection-test', title: '新闻测试', author: '作者', source_name: '来源', region: '安徽', publish_time: '2026-02-28T23:59:59+08:00', source_url: 'https://example.invalid/article', content: 'PRIVATE BODY', raw_html: 'PRIVATE HTML' }).execute();
    await client.connect(transport);
    const listed = await client.callTool({ name: 'list_recent_news', arguments: { start_date: '2026-02-28', end_date: '2026-02-28', keyword: '新闻' } });
    const news = output(listed).news as Record<string, unknown>[];
    assert.equal(news.length, 1);
    assert.deepEqual(Object.keys(news[0]).sort(), ['source_id','title','author','source_name','region','publish_time','url'].sort());
    assert.equal(news[0].publish_time, '2026-02-28T23:59:59.000+08:00');
    assert.doesNotMatch(JSON.stringify(listed), /PRIVATE/);
    assert.equal((await client.callTool({ name: 'list_recent_news', arguments: { start_date: '2026-02-30' } })).isError, true);
    const task = output(await client.callTool({ name: 'start_crawl', arguments: { pages: 1 } }));
    assert.equal(output(await client.callTool({ name: 'cancel_crawl', arguments: {} })).state, 'cancelled');
    // Missing upstream login reserves a new task without any remote crawl calls.
    await client.callTool({ name: 'start_crawl', arguments: { pages: 1 } });
    await client.callTool({ name: 'start_crawl', arguments: { pages: 1 } });
    assert.equal((await client.callTool({ name: 'start_crawl', arguments: { pages: 1 } })).isError, true);
    for (let i = 0; i < 10; i++) assert.notEqual((await client.callTool({ name: 'get_captcha', arguments: {} })).isError, true);
    assert.equal((await client.callTool({ name: 'submit_captcha', arguments: { code: '1234', login_session_id: 'unused' } })).isError, true);
    const row = await db.selectFrom('mcp_audit_log').selectAll().orderBy('id', 'desc').executeTakeFirstOrThrow();
    assert.equal(row.ok, false); assert.equal(row.tool, 'submit_captcha'); assert.deepEqual(row.args_redacted, { code_length: 4 });
    now = 60_000;
    assert.notEqual((await client.callTool({ name: 'get_captcha', arguments: {} })).isError, true);
    assert.equal((await controller.getStatus(task.task_id as string))?.status, 'cancelled');
  } finally { await client.close(); await controller.waitForIdle(); await db.destroy(); }
});

test('SDK pause/resume/cancel share controller and captcha login preserves user-requested pauses', async () => {
  const { db, auth } = await fixture(); let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const controller = createCrawlController({ db, delay: async () => {}, getListPage: async page => { await blocked; return { page, total: 0, articles: [] }; } });
  await saveCjSession('auth=fake', new Date(Date.now() + 60_000), db);
  const handler = createMcpHandler({ db, controller, env, log: () => {}, upstream: {
    getCaptcha: async () => ({ imageBuffer: Buffer.from('image'), mimeType: 'image/png', cookies: ['captcha=fake'] }),
    login: async () => ({ success: true, cookies: ['auth=fake'] }), checkLoginStatus: async () => true,
  } });
  const { client, transport } = clientFor(handler, auth);
  try {
    await client.connect(transport);
    await client.callTool({ name: 'start_crawl', arguments: { pages: 1 } });
    const paused = output(await client.callTool({ name: 'pause_crawl', arguments: {} }));
    assert.equal(paused.state, 'paused'); assert.equal(paused.pause_reason, 'user_requested');
    const cap = output(await client.callTool({ name: 'get_captcha', arguments: {} }));
    const login = output(await client.callTool({ name: 'submit_captcha', arguments: { code: '1234', login_session_id: cap.login_session_id } }));
    assert.equal(login.logged_in, true); assert.equal(login.resumed_task_id, undefined);
    assert.equal((await controller.getCurrent())?.pauseReason, 'user_requested');
    // An explicit resume after login expiry must change the pause reason so captcha can continue it.
    await db.updateTable('login_sessions').set({ is_valid: false }).execute();
    const needsLogin = output(await client.callTool({ name: 'resume_crawl', arguments: {} }));
    assert.equal(needsLogin.needs_captcha, true);
    assert.equal(needsLogin.pause_reason, 'cj_login_required');
    const nextCap = output(await client.callTool({ name: 'get_captcha', arguments: {} }));
    const continued = output(await client.callTool({ name: 'submit_captcha', arguments: { code: '1234', login_session_id: nextCap.login_session_id } }));
    assert.equal(continued.resumed_task_id, paused.task_id);
    assert.equal((await controller.getCurrent())?.status, 'running');
    assert.equal(output(await client.callTool({ name: 'cancel_crawl', arguments: {} })).state, 'cancelled');
    release(); await controller.waitForIdle();
    assert.equal(output(await client.callTool({ name: 'get_crawl_status', arguments: {} })).state, 'cancelled');
  } finally { release(); await client.close(); await controller.waitForIdle(); await db.destroy(); }
});
