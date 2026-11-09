import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

function startup(env: Record<string, string | undefined>) {
  const childEnv: NodeJS.ProcessEnv = { ...process.env, NEXT_RUNTIME: 'nodejs', ...env };
  delete childEnv.NEXT_PHASE;
  if (env.NEXT_PHASE !== undefined) childEnv.NEXT_PHASE = env.NEXT_PHASE;
  return spawnSync(process.execPath, [
    '--conditions=react-server', '--import', 'tsx', '--eval',
    // Next catches instrumentation errors; a rejected register() alone must not pass.
    `const { register } = require('./src/instrumentation.ts');
     register().catch(error => console.error(error))
       .then(() => console.log('startup completed'));`,
  ], {
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    env: childEnv,
    encoding: 'utf8',
    timeout: 10_000,
  });
}

for (const [name, env, expected] of [
  ['missing JWT_SECRET', { JWT_SECRET: undefined, DATABASE_URL: 'postgres://localhost/test' }, /JWT_SECRET/],
  ['blank JWT_SECRET', { JWT_SECRET: '  ', DATABASE_URL: 'postgres://localhost/test' }, /JWT_SECRET/],
  ['missing DATABASE_URL', { JWT_SECRET: 'test-only-secret', DATABASE_URL: undefined }, /DATABASE_URL/],
  ['blank DATABASE_URL', { JWT_SECRET: 'test-only-secret', DATABASE_URL: '  ' }, /DATABASE_URL/],
] as const) {
  test(`Node runtime startup exits 1 for ${name} even when the framework catches errors`, () => {
    const result = startup(env);
    assert.ifError(result.error);
    assert.equal(result.signal, null);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, expected);
    assert.doesNotMatch(result.stdout, /startup completed/);
  });
}

test('configured Node runtime startup succeeds', () => {
  const result = startup({ JWT_SECRET: 'test-only-secret', DATABASE_URL: 'postgres://localhost/test' });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /startup completed/);
});

test('production builds need neither secret nor database URL', () => {
  const result = startup({
    JWT_SECRET: undefined, DATABASE_URL: undefined, NEXT_PHASE: 'phase-production-build',
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /startup completed/);
});
