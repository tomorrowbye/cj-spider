import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { createRequire } from 'node:module';
import { NextRequest } from 'next/server';

const require = createRequire(import.meta.url);
require('../src/lib/auth-gate.ts');
require('../src/lib/cj-auth.ts');
require('../src/lib/crawl/task-manager.ts');
const check = mock.fn(async (cookie: string) => cookie === 'auth=valid');
const start = mock.fn(async () => ({ status: 'running' }));
const resume = mock.fn(async () => true);
const retry = mock.fn(async () => ({ count: 1 }));
require.cache[require.resolve('../src/lib/auth-gate.ts')]!.exports = { requireSiteAuth: async () => null };
require.cache[require.resolve('../src/lib/cj-auth.ts')]!.exports = { checkLoginStatus: check };
require.cache[require.resolve('../src/lib/crawl/task-manager.ts')]!.exports = {
  startCrawlTask: start, resumeCrawlTask: resume, retryFailedArticles: retry,
};
const routes = ['start', 'resume', 'retry'].map(name => ({ name,
  post: require(`../src/app/api/crawl/${name}/route.ts`).POST as (r: NextRequest) => Promise<Response>,
}));

for (const { name, post } of routes) {
  test(`Web ${name} rejects missing/expired cookies before invoking the controller`, async () => {
    for (const cookie of [undefined, 'auth=expired']) {
      start.mock.resetCalls(); resume.mock.resetCalls(); retry.mock.resetCalls(); check.mock.resetCalls();
      const response = await post(new NextRequest(`http://localhost/api/crawl/${name}`, {
        method: 'POST', headers: cookie ? { Cookie: `cj_auth=${encodeURIComponent(cookie)}` } : {},
        body: JSON.stringify({ startPage: 1, endPage: 2, sessionId: '1' }),
      }));
      assert.equal(response.status, 401);
      assert.equal(start.mock.callCount() + resume.mock.callCount() + retry.mock.callCount(), 0);
      assert.equal(check.mock.callCount(), cookie ? 1 : 0);
    }
  });
  test(`Web ${name} passes only a verified cookie to the controller`, async () => {
    start.mock.resetCalls(); resume.mock.resetCalls(); retry.mock.resetCalls(); check.mock.resetCalls();
    const response = await post(new NextRequest(`http://localhost/api/crawl/${name}`, {
      method: 'POST', headers: { Cookie: `cj_auth=${encodeURIComponent('auth=valid')}` },
      body: JSON.stringify({ startPage: 1, endPage: 2, sessionId: '1' }),
    }));
    assert.equal(response.status, 200);
    assert.deepEqual(check.mock.calls[0]?.arguments, ['auth=valid']);
    const calls = name === 'start' ? start.mock.calls : name === 'resume' ? resume.mock.calls : retry.mock.calls;
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].arguments, name === 'start'
      ? [{ startPage: 1, endPage: 2, skipExisting: true, cookie: 'auth=valid' }]
      : name === 'resume' ? ['1', 'auth=valid'] : ['auth=valid']);
  });
}
