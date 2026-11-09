import assert from 'node:assert/strict';
import { test } from 'node:test';
import jwt from 'jsonwebtoken';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const secret = 'test-only-auth-secret';

test('JWT secret is required, including blank values; module import needs no secret', async () => {
  const { getJwtSecret, validateRuntimeEnv } = await import('../src/lib/server-env');
  for (const value of [undefined, '', '  ']) {
    assert.throws(() => getJwtSecret({ JWT_SECRET: value }), /JWT_SECRET/);
  }
  assert.equal(getJwtSecret({ JWT_SECRET: secret }), secret);
  assert.throws(() => validateRuntimeEnv({ JWT_SECRET: secret }), /DATABASE_URL/);
  assert.throws(() => validateRuntimeEnv({ DATABASE_URL: 'postgres://localhost/test' }), /JWT_SECRET/);
  assert.doesNotThrow(() => validateRuntimeEnv({ JWT_SECRET: secret, DATABASE_URL: 'postgres://localhost/test' }));
});

test('invalid, expired, wrong-algorithm and malformed JWTs are rejected', async () => {
  process.env.JWT_SECRET = secret;
  const { verifyToken, generateToken } = await import('../src/lib/jwt');
  assert.equal(verifyToken('invalid'), null);
  assert.equal(verifyToken(jwt.sign({ userId: 1 }, secret, { expiresIn: -1 })), null);
  assert.equal(verifyToken(jwt.sign({ userId: 1 }, secret, { algorithm: 'HS384' })), null);
  assert.equal(verifyToken(jwt.sign({ userId: '1' }, secret)), null);
  assert.equal(verifyToken(jwt.sign({ userId: 1 }, secret)), null); // expiry is mandatory
  assert.equal(verifyToken(generateToken({ id: 1, username: 'alice', role: 'user' }))?.userId, 1);
});

test('session checks database each time and rejects disabled/deleted users', async () => {
  process.env.JWT_SECRET = secret;
  const { generateToken } = await import('../src/lib/jwt');
  const { resolveSession } = await import('../src/lib/auth-session');
  const token = generateToken({ id: 1, username: 'alice', role: 'admin' });
  let calls = 0;
  let user: { id: number; role: string; is_active: boolean } | null = { id: 1, role: 'user', is_active: true };
  const lookup = async (id: number) => { calls++; assert.equal(id, 1); return user; };
  assert.equal((await resolveSession(token, lookup))?.role, 'user');
  user = { id: 1, role: 'user', is_active: false };
  assert.equal(await resolveSession(token, lookup), null);
  user = null;
  assert.equal(await resolveSession(token, lookup), null);
  assert.equal(calls, 3);
  assert.equal(await resolveSession('invalid', lookup), null);
  assert.equal(calls, 3);
});

test('API gate returns 401 without an active user and 403 for non-admin', async () => {
  const { authorizeApi } = await import('../src/lib/auth-gate');
  assert.equal((await authorizeApi(null))?.status, 401);
  assert.equal((await authorizeApi({ role: 'admin', is_active: false }, true))?.status, 401);
  assert.equal((await authorizeApi({ role: 'user', is_active: true }, true))?.status, 403);
  assert.equal(await authorizeApi({ role: 'admin', is_active: true }, true), null);
  assert.equal(await authorizeApi({ role: 'user', is_active: true }), null);
});

test('every sensitive API handler starts with authentication before doing work', () => {
  function visit(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? visit(join(dir, entry.name)) : entry.name === 'route.ts' ? [join(dir, entry.name)] : []);
  }
  for (const group of ['auth', 'crawl', 'news', 'stats']) {
    for (const path of visit(join(process.cwd(), 'src/app/api', group))) {
      const source = readFileSync(path, 'utf8');
      const handlers = [...source.matchAll(/export async function (GET|POST|PATCH|DELETE|PUT)\([^)]*\)\s*\{/g)];
      assert.ok(handlers.length > 0, path);
      for (const handler of handlers) {
        const body = source.slice(handler.index! + handler[0].length);
        assert.match(body, /^\s*const authError = await requireSiteAuth\(\);\s*if \(authError\) return authError;/, `${path} ${handler[1]}`);
      }
    }
  }
  const users = readFileSync('src/app/api/users/route.ts', 'utf8');
  assert.equal((users.match(/currentUser.role !== "admin"/g) || []).length, 4);
});

test('runtime instrumentation validates configuration but skips production build', () => {
  const source = readFileSync('src/instrumentation.ts', 'utf8');
  assert.match(source, /phase-production-build/);
  assert.match(source, /validateRuntimeEnv/);
  assert.match(source, /NEXT_RUNTIME/);
});
