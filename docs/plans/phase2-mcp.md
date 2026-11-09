# Phase 2 MCP Implementation Plan

Aligned with the 2026-11-10 second revision of `~/workspace/cj-spider-refactor/HERMES_TASK_PHASE2.md`: per-user revocable API Keys, no scopes, permissions follow the account's current role, and admin-only `create_user`.

## Architecture and decisions

- Official `@modelcontextprotocol/sdk` 1.32.2, Next.js Node.js/force-dynamic route `/api/mcp`, server `cj-spider` with package.json version. Create a Web Standard Streamable HTTP server/transport per request in stateless mode; delegate POST/GET/DELETE semantics to the SDK.
- Nine tools: start_crawl, get_crawl_status, get_captcha, submit_captcha, pause_crawl, resume_crawl, cancel_crawl, create_user, list_recent_news. Each has a Chinese description and strict Zod schema. Both roles see all nine in tools/list; enforce admin role when create_user is called.
- JSON text plus structuredContent for results; get_captcha also returns image content with the actual upstream MIME type. list_recent_news text stays a JSON array; structuredContent wraps it as `{ "news": [...] }`. Output timestamps use +08:00.
- API Key format `cjsk_<8 hex characters>_<base64url secret from 32 random bytes>`. Persist SHA-256 of the complete Key only, lookup by prefix, timingSafeEqual digest comparison including a dummy comparison for unknown prefixes. No HMAC configuration is needed.
- Each request rereads the user's current role and is_active from the database. Disabled/deleted users and missing/invalid/revoked/expired Keys receive uniform 401 with WWW-Authenticate: Bearer. No usable Keys does not prevent startup. No scopes or global MCP authentication environment settings.
- Reuse existing crawler, news service, authentication and repositories. Server-side upstream cookies live in login_sessions and are never returned. Web JWT/cj_auth flows remain compatible; Key authentication is exclusive to `/api/mcp`.

## Task 1: Persistent shared crawler lifecycle

Files: db/migrations/002-mcp.ts, db/migrate.ts, src/lib/db.ts, src/lib/crawl/task-manager.ts, src/lib/crawl/types.ts, src/app/api/crawl/start/route.ts, src/lib/cj-session-repository.ts, src/lib/crawl-repository.ts, tests/crawl-lifecycle.test.ts.

Use the version ledger for idempotent 002 migration. Persist absolute start/end/next page, skip flag, pause reason, pending login intent, execution generation, recent titles and idempotency metadata. Preserve relative current_page for existing Web consumers.

Use `LOCK TABLE crawl_sessions IN SHARE ROW EXCLUSIVE MODE` within a transaction to serialize active task reservation across Web and MCP: only one running or paused task globally. MCP start returns the existing task with already_running:true; Web start returns 409 with that task. Reuse the same task_id for an idempotency_key within ten minutes, including completed tasks.

When a list page requires login, pause with cj_login_required, invalidate the rejected server session and retain the failed absolute page. After verified captcha login, start the pending request or resume from that page through the original end_page. Manual pauses require explicit resume; resume with invalid login records captcha intent. Prevent stale in-flight operations overwriting pause/cancel using execution generations; retain inserted articles on cancellation. Recover leftover running rows to paused/server_restart on first access. Test concurrency, idempotency, absolute resume boundaries, expiration, cancellation and restart recovery with PGlite and mocked upstream calls.

Deployment remains one Next.js process/replica: captcha sessions, rate buckets, execution coordination and restart recovery are process-local. The database reservation lock alone is not a multi-replica worker protocol.

## Task 2: Per-user API Key persistence, management and UI

Files: db/migrations/002-mcp.ts, src/lib/db.ts, src/lib/api-keys.ts, src/app/api/api-keys/*, src/components/api-key-manager.tsx, src/app/profile/page.tsx, src/app/users/page.tsx, tests/api-keys.test.ts.

Create api_keys with user foreign key ON DELETE CASCADE, unique prefix, hash, name, timestamps and optional expiration/revocation; index user_id, with no scope column. Limit each user to ten unrevoked Keys, including expired Keys, under a per-user transaction row lock. Return the complete Key only in its creation response. Throttle last_used_at writes to over sixty seconds since the previous update.

Management routes require normal JWT Cookie login via requireSiteAuth, never API Key authentication: GET lists own metadata; POST accepts name and optional expires_in_days; DELETE /:id revokes own Key. Administrators may GET ?all=1 with usernames and revoke any Key. Non-admin all=1 returns 403. Key creation/revocation logs contain actor, time and prefix only.

At `/profile`, provide metadata listing, creation with name/optional lifetime, one-time full Key dialog and copy button, and revocation confirmation using existing shadcn styles. At admin `/users`, show all users' Key metadata and revocation controls. Test secrecy, Key cap, ownership, admin access, invalid/expired/revoked/disabled/deleted cases, and rejection of Key-only requests by other site APIs.

## Task 3: MCP protocol, roles, captcha and audit

Files: src/lib/mcp/*, src/app/api/mcp/route.ts, src/lib/auth.ts, src/app/api/users/route.ts, src/lib/cj-auth.ts, src/lib/session-store.ts, src/app/api/auth/login/route.ts, package.json, pnpm-lock.yaml, tests/mcp-security.test.ts, tests/mcp-accounts.test.ts.

Any enabled user/admin Key may use the eight crawler/news/captcha tools. Ordinary users calling create_user get an audited MCP isError result `forbidden: admin only`. Demotion immediately removes that permission; disabled administrators get 401. Extract shared createUserValidated rules for both MCP and /api/users POST: username 3–50 characters, supplied password at least four, role user/admin default user, clear duplicate username error. Reuse the transactional bcrypt plus site_users/local auth_identity write. Omitted password generates a cryptographically random password of at least sixteen characters, returned only once in generated_password and never logged or audited.

Captcha sessions reuse session-store, expire after five minutes, are single-use and bound to the MCP user, isolated from Web sessions. Merge cookie pairs, call login with runtime CJ_USERNAME/CJ_PASSWORD, then verify with checkLoginStatus before saving the server cookie and resuming the waiting task. Missing credentials make get_captcha/submit_captcha return a clear error while startup remains available. Remove secret-bearing Web login logs. Never expose upstream raw errors or cookies.

Per-Key token buckets allow sixty calls/minute overall, ten combined captcha calls/minute and three starts/minute. Rate-limit authentication failures by source IP at twenty/minute. Every tool call gets mcp_audit_log user_id/api_key_id, redacted arguments, success/error, duration and task_id plus a structured prefix-only log. Audit foreign keys use ON DELETE SET NULL. Captcha audit stores code length; create_user audit stores username, role and provided/generated password source only. Test strict schemas, redaction, roles, rate limits and safe errors.

## Task 4: SDK integration and operator documentation

Files: tests/mcp-integration.test.ts, docs/MCP.md, .env.example, docker-compose.yml.

Use real SDK Client + StreamableHTTPClientTransport against route handlers with PGlite, freshly generated Keys and fully mocked upstream requests. Check nine listed tools for both roles; start → needs_captcha → image → submit → status; invalid/revoked Keys; ordinary-user denial and administrator success for create_user; safe news projections; absolute expiration/resume behavior. Keep auth-security regression coverage unchanged.

Document every tool's input/output and errors, `/profile` Key creation and `/users` administrator management, current-role permissions, client Authorization header, and Inspector checks for ordinary/admin Keys including demotion/disable/revocation. `.env.example` contains only placeholder CJ_USERNAME/CJ_PASSWORD; Compose forwards them at runtime. No shared MCP credential settings in any configuration.

The exact operator deployment sequence is documented in [MCP.md](../MCP.md):

1. Append private CJ_USERNAME/CJ_PASSWORD to server `~/wakaja/spider/.env.production`, keeping DATABASE_URL/JWT_SECRET and removing historical shared MCP settings.
2. Back up the database, stop old writes, install frozen dependencies from the release source, explicitly inject the protected runtime environment and run `pnpm db:migrate`; verify `002-mcp` in the migration ledger. The migration command does not auto-load `.env.production`, and the runner image does not include the migration toolchain.
3. Replace the image with an immutable release version; use the updated Compose and `--env-file .env.production` to pull and start one instance without rebuilding.
4. Verify health, site login and existing APIs, Key UI, uniform unauthenticated 401, then Inspector list/status/news/captcha plus normal-user forbidden and admin-success create_user checks.

These are operator instructions only. This documentation task does not execute deployment, migrations, Inspector writes, production access or real upstream requests.

## Validation and handoff

Implementation validation requirements: `pnpm install --frozen-lockfile`, `pnpm test`, `pnpm lint`, `pnpm typecheck`, secret-free `pnpm build`, `git diff --check`. Tests must generate Keys or use unmistakable dummy values; never commit credentials or backups. Check docs/configuration for stale shared authentication settings and eight-tool claims.

For this delegated update, modify only docs/MCP.md, docs/plans/phase2-mcp.md, .env.example and docker-compose.yml, verify their consistency and leave existing implementation work intact. Do not commit or push. Record verification results separately from planned implementation checks; do not claim unrun tests passed.
