import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFailedAuthLimiter, createRateLimiter, redactArgs } from '../src/lib/mcp/security';
import { startSchema, newsSchema } from '../src/lib/mcp/schemas';

test('failed authentication is limited to twenty per IP per minute', () => {
  let now = 0;
  const limiter = createFailedAuthLimiter(() => now);
  for (let i = 0; i < 20; i++) { assert.equal(limiter.blocked('one'), false); limiter.record('one'); }
  assert.equal(limiter.blocked('one'), true);
  assert.equal(limiter.blocked('two'), false);
  now = 60_000;
  assert.equal(limiter.blocked('one'), false);
  limiter.record('one');
  assert.equal(limiter.blocked('one'), false);
});
test('independent shared captcha/start/global buckets refill', () => {
  let now = 0; const take = createRateLimiter(() => now);
  for (let i = 0; i < 10; i++) assert.equal(take('get_captcha'), true);
  assert.equal(take('submit_captcha'), false);
  for (let i = 0; i < 3; i++) assert.equal(take('start_crawl'), true);
  assert.equal(take('start_crawl'), false);
  for (let i = 0; i < 47; i++) assert.equal(take('get_crawl_status'), true);
  assert.equal(take('get_crawl_status'), false);
  now = 60_000; assert.equal(take('submit_captcha'), true);
});
test('strict ranges, dates and redaction', () => {
  for (const args of [{}, { pages: 101 }, { pages: 1, start_page: 1, end_page: 2 }, { start_page: 3, end_page: 2 }, { start_page: 1, end_page: 101 }, { pages: 1, cookie: 'secret' }]) assert.equal(startSchema.safeParse(args).success, false);
  assert.equal(startSchema.parse({ pages: 2 }).skip_existing, true);
  assert.equal(startSchema.safeParse({ start_page: 101, end_page: 200 }).success, true);
  assert.equal(newsSchema.safeParse({ start_date: '2026-02-30' }).success, false);
  assert.equal(newsSchema.safeParse({ start_date: '2024-02-29' }).success, true);
  assert.deepEqual(redactArgs('submit_captcha', { code: '1234', login_session_id: 'secret', token: 'secret', cookie: 'secret' }), { code_length: 4 });
  assert.deepEqual(redactArgs('create_user', { username: 'alice', password: 'secret', role: 'admin', key: 'secret' }), { username: 'alice', role: 'admin', password_source: 'provided' });
  assert.deepEqual(redactArgs('create_user', { username: 'alice' }), { username: 'alice', role: 'user', password_source: 'generated' });
});
