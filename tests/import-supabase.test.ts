import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { Kysely, PGliteDialect, sql } from 'kysely';
import { PGlite } from '@electric-sql/pglite';
import { migrate } from '../db/migrate';
import type { Database } from '../src/lib/db';

type Row = Record<string, unknown>;
const names = ['news', 'site_users', 'crawl_sessions', 'export_history', 'crawl_tasks', 'login_sessions'];
function source(data: Record<string, Row[]>, options: { unknownTable?: boolean; unknownColumn?: boolean; noCount?: boolean; changing?: boolean; changeAt?: number; repeat?: boolean; unavailable?: boolean } = {}) {
  const requests: URL[] = [];
  const heads: Record<string, number> = {};
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    requests.push(url);
    assert.equal(new Headers(init?.headers).get('apikey'), 'fixture-key');
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer fixture-key');
    if (url.pathname === '/rest/v1/') {
      if (options.unavailable) return new Response('', {status: 503});
      return Response.json({ paths: Object.fromEntries([...Object.keys(data), ...(options.unknownTable ? ['unmapped'] : [])].map(n => [`/${n}`, {get: {}}])), definitions: options.unknownColumn ? { news: {properties: {id: {}, mystery: {}}} } : {} });
    }
    const name = url.pathname.split('/').pop()!;
    if (!data[name]) return Response.json({code: 'PGRST205'}, {status: 404});
    if (init?.method === 'HEAD') {
      heads[name] = (heads[name] ?? 0) + 1;
      const count = data[name].length + (options.changing && heads[name] >= (options.changeAt ?? 2) ? 1 : 0);
      return new Response(null, {headers: options.noCount ? {} : {'content-range': `*/${count}`}});
    }
    assert.equal(url.searchParams.get('order'), 'id.asc');
    assert.equal(url.searchParams.has('offset'), false);
    const after = BigInt(url.searchParams.get('id')?.slice(3) ?? '0');
    const rows = data[name].filter(r => options.repeat || BigInt(String(r.id)) > after).slice(0, Math.min(2, Number(url.searchParams.get('limit'))));
    return Response.json(rows);
  };
  return {fetcher, requests};
}
async function importer() {
  assert.ok(existsSync('scripts/import-supabase.ts'), 'importer implementation must exist');
  return import('../scripts/import-supabase');
}
const config = {url: 'https://fixture.invalid', serviceKey: 'fixture-key', pageSize: 5};
const fixture = (): Record<string, Row[]> => ({
  news: [1, 7, 22, 35, 90].map(id => ({id, source_id: `n${id}`, title: '完整新闻', tags: ['中文', 'a,b'], images: [{url: 'image', metadata: {width: 42}}], qr_codes: [{value: 'qr'}], contact_info: {phones: ['123']}, related_links: [{url:'link'}], raw_html: '<p>raw</p>', publish_time: '2026-04-10T21:46:24.123456', created_at: '2026-04-10', updated_at: '2026-04-10T22:00:00+08:00'})),
  site_users: [{id: 48, username: 'existing', password_hash: '$2b$fixture-unchanged', created_at: '2026-04-10 21:46:24', updated_at: '2026-04-11 10:00:00'}],
  crawl_sessions: [{id: 30, session_name:'session', started_at:'2026-04-10 21:46:24'}],
  export_history: [{id: 40, total_count:5, columns:['title','images'], file_name:'旧文件.xlsx', start_date:'2026-04-10'}],
  crawl_tasks: [{id: 70, task_type:'detail', target_url:'https://fixture.invalid/item', retry_count:3}],
  login_sessions: [{id:80, cookies:'[{"name":"fixture"}]', user_agent:'fixture-agent', expires_at:'2026-04-11 10:00:00'}],
});

test('keyset pagination survives server page caps and checks exact counts', async () => {
  const {readSource} = await importer();
  const mock = source(fixture());
  const result = await readSource({...config, fetcher:mock.fetcher, warn:()=>{}});
  assert.equal(result.news.length, 5);
  assert.equal(result.news[0].publish_time, '2026-04-10T21:46:24.123456Z');
  assert.equal(result.news[0].created_at, '2026-04-10T00:00:00Z');
  assert.equal(result.site_users[0].created_at, '2026-04-10T21:46:24Z');
  assert.equal(result.news[0].updated_at, '2026-04-10T22:00:00+08:00');
  const pages = mock.requests.filter(u=>u.pathname.endsWith('/news') && u.searchParams.has('limit'));
  assert.deepEqual(pages.map(u=>u.searchParams.get('id')), [null, 'gt.7', 'gt.35', 'gt.90']);
});

test('source validation fails closed and missing legacy tables warn', async () => {
  const {readSource} = await importer();
  for (const options of [{unknownTable:true}, {unknownColumn:true}, {noCount:true}, {changing:true}, {repeat:true}]) {
    await assert.rejects(readSource({...config, fetcher:source(fixture(),options).fetcher, warn:()=>{}}));
  }
  const unknown = fixture(); unknown.news[0].mystery = 'keep-or-fail';
  await assert.rejects(readSource({...config, fetcher:source(unknown).fetcher, warn:()=>{}}), /column/);
  const missingCore = fixture(); delete missingCore.news;
  await assert.rejects(readSource({...config, fetcher:source(missingCore).fetcher, warn:()=>{}}), /news/);
  const missingLegacy = fixture(); delete missingLegacy.crawl_tasks; delete missingLegacy.login_sessions;
  const warnings: string[] = [];
  await readSource({...config, fetcher:source(missingLegacy).fetcher, warn:m=>warnings.push(m)});
  assert.ok(warnings.some(m=>m.includes('crawl_tasks')));
  assert.ok(warnings.some(m=>m.includes('login_sessions')));
});

test('real PostgreSQL import reruns preserve timestamps, hashes, JSON, identities and sequences; failures roll back', async () => {
  const {importSupabase} = await importer();
  const db = new Kysely<Database>({dialect:new PGliteDialect({pglite:new PGlite()})});
  try {
    await migrate(db);
    const data = fixture();
    const run = (rows=data, options={}) => importSupabase(db, {...config, fetcher:source(rows,options).fetcher, warn:()=>{}});
    await run();
    await run();
    for (const name of names) {
      const result = await sql<{n:string}>`select count(*)::text as n from ${sql.table(name)}`.execute(db);
      assert.equal(Number(result.rows[0].n), data[name].length);
    }
    const article = await db.selectFrom('news').selectAll().where('id','=',1).executeTakeFirstOrThrow();
    assert.equal(new Date(article.publish_time!).toISOString(), '2026-04-10T21:46:24.123Z');
    assert.equal(new Date(article.created_at).toISOString(), '2026-04-10T00:00:00.000Z');
    assert.equal(new Date(article.updated_at).toISOString(), '2026-04-10T14:00:00.000Z');
    for (const field of ['tags','images','qr_codes','contact_info','related_links','raw_html'] as const) assert.deepEqual(article[field], data.news[0][field]);
    const user = await db.selectFrom('site_users').selectAll().executeTakeFirstOrThrow();
    assert.equal(user.password_hash, data.site_users[0].password_hash);
    assert.equal(new Date(user.updated_at).toISOString(), '2026-04-11T10:00:00.000Z');
    const identity = await db.selectFrom('auth_identities').selectAll().executeTakeFirstOrThrow();
    assert.equal(Number(identity.user_id),48); assert.equal(identity.provider_subject,'existing');
    const triggers = await sql<{tgenabled:string}>`select tgenabled from pg_trigger where tgname in ('news_updated_at','site_users_updated_at')`.execute(db);
    assert.deepEqual(triggers.rows.map(r=>r.tgenabled), ['O','O']);
    await db.updateTable('news').set({title:'trigger active'}).where('id','=',1).execute();
    assert.notEqual(new Date((await db.selectFrom('news').select('updated_at').where('id','=',1).executeTakeFirstOrThrow()).updated_at).toISOString(), '2026-04-10T14:00:00.000Z');
    await run();
    const changed = fixture(); changed.news[0].title = 'must roll back';
    await assert.rejects(run(changed, {changing:true, changeAt:3}));
    assert.equal((await db.selectFrom('news').select('title').where('id','=',1).executeTakeFirstOrThrow()).title, '完整新闻');
    const preserved = await db.selectFrom('news').select('updated_at').where('id','=',1).executeTakeFirstOrThrow();
    assert.equal(new Date(preserved.updated_at).toISOString(), '2026-04-10T14:00:00.000Z');
    const bad = fixture(); bad.site_users[0].username = null;
    await assert.rejects(run(bad));
    assert.equal((await db.selectFrom('site_users').select('username').executeTakeFirstOrThrow()).username,'existing');
    const next = await db.insertInto('news').values({source_id:'extra',title:'extra'}).returning('id').executeTakeFirstOrThrow();
    assert.equal(Number(next.id),91);
    await assert.rejects(run(), /extra|target/i);
    await db.deleteFrom('news').where('source_id','=','extra').execute();
    await sql`alter table news add column unmapped text`.execute(db);
    await assert.rejects(run(), /column/);
  } finally {await db.destroy();}
});
