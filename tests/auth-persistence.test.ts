import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

test('account creation stores a local identity atomically with the password account', () => {
  const source = readFileSync('src/lib/auth.ts', 'utf8');
  assert.match(source, /\(db \?\? getDb\(\)\)\.transaction\(\)\.execute/);
  assert.match(source, /trx\.insertInto\("site_users"\)/);
  assert.match(source, /trx\.insertInto\("auth_identities"\)/);
  assert.match(source, /provider: "local"/);
  assert.match(source, /provider_subject: username/);
  assert.match(source, /password_hash: passwordHash/);
  assert.doesNotMatch(source, /supabase/);
});

test('profile retains current password verification and password update flow on Postgres', () => {
  const source = readFileSync('src/app/api/site-auth/profile/route.ts', 'utf8');
  assert.match(source, /getDb\(\)/);
  assert.match(source, /verifyPassword\(currentPassword, userData.password_hash\)/);
  assert.match(source, /updateUserPassword\(user.id, newPassword\)/);
  assert.match(source, /newPassword.length < 4/);
  assert.doesNotMatch(source, /supabase/);
});
