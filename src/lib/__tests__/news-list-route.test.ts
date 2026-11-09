import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { NextRequest } from 'next/server';

const require = createRequire(import.meta.url);
require('../auth-gate.ts');
require('../news-service.ts');
const authenticate = mock.fn(async () => null);
const list = mock.fn(async (params: import('../news-service').NewsSearchParams) => ({data:[], total:0, page:params.page ?? 1, pageSize:params.pageSize ?? 20, totalPages:0}));
require.cache[require.resolve('../auth-gate.ts')]!.exports = {requireSiteAuth:authenticate};
require.cache[require.resolve('../news-service.ts')]!.exports = {...require('../news-service.ts'), getNewsList:list};
const { GET } = require('../../app/api/news/list/route.ts') as typeof import('../../app/api/news/list/route');

test('news list rejects malformed pagination and sort before querying the database', async () => {
  list.mock.resetCalls();
  try {
    const invalid = [
      ...['page', 'pageSize'].flatMap(key => ['', 'junk', '2junk', '1.5', '0', '-1', 'NaN', 'Infinity', '9007199254740992', '1e2', ' 2', '0x10'].map(value => new URLSearchParams({[key]:value}))),
      new URLSearchParams({page:'9007199254740991', pageSize:'20'}),
      ...['', 'ASC', 'sideways', 'asc nulls first'].map(order => new URLSearchParams({order})),
      ...['', 'unknown', 'title desc', 'title; DROP TABLE news'].map(orderBy => new URLSearchParams({orderBy})),
    ];
    for (const query of invalid) {
      const response = await GET(new NextRequest(`http://localhost/api/news/list?${query}`));
      assert.equal(response.status, 400, query.toString());
      assert.equal((await response.json()).success, false);
    }
    assert.equal(list.mock.callCount(), 0, 'invalid input must never call the data service');
  } finally { authenticate.mock.restore(); list.mock.restore(); }
});

test('news list keeps defaults and accepts UI sizes and safe large pagination', async () => {
  list.mock.resetCalls();
  try {
    assert.equal((await GET(new NextRequest('http://localhost/api/news/list'))).status, 200);
    assert.deepEqual(list.mock.calls[0].arguments[0], {
      author:undefined, region:undefined, sourceName:undefined, category:undefined,
      startDate:undefined, endDate:undefined, status:undefined, keyword:undefined, title:undefined,
      page:1, pageSize:20, orderBy:'source_id', order:'desc',
    });
    for (const query of ['page=2&pageSize=100&orderBy=publish_time&order=asc', 'page=1000000&pageSize=1000&orderBy=updated_at&order=desc', 'page=1&pageSize=9007199254740991']) {
      assert.equal((await GET(new NextRequest(`http://localhost/api/news/list?${query}`))).status, 200, query);
    }
    assert.equal(list.mock.callCount(), 4);
  } finally { authenticate.mock.restore(); list.mock.restore(); }
});
