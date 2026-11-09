# Phase 1 PostgreSQL Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Replace Supabase with server-only PostgreSQL, preserve every current feature, and secure authenticated operations.

**Architecture:** Use Kysely with pg and versioned migrations; retain original table/field names and API payloads. Separate site_users from provider identities for future WeChat; retain existing password login. Migration imports Supabase REST pages with explicit counts, stable ordering, upserts and sequence repair.

**Tech Stack:** Next.js 16, TypeScript, Kysely, pg, tsx/node:test.

## Task 1: Data layer and schema
- Inspect every `from` / `rpc` caller and database design documents.
- Add behavior tests for filtering, article insert deduplication, all stats responses and date conversion; verify failure before implementation.
- Create `src/lib/db.ts`, migrations and migration runner; use lazy server-only connection creation with Asia/Shanghai session timezone.
- Replace `src/lib/supabase.ts` with `src/lib/article-repository.ts` and migrate `src/lib/news-service.ts`, stats/news/crawl API data calls and task-manager. Preserve original response fields and all news metadata.
- Schema must include news, site_users, auth_identities, crawl_sessions, export_history and legacy crawl_tasks/login_sessions.
- Run tests and typecheck; report changes for review.

## Task 2: Authentication
- Write failing JWT/auth route tests; validate absent secret, malformed/expired token, disabled users, and non-admin access.
- Migrate `src/lib/auth.ts` and profile DB calls to Kysely; keep password hashes and user IDs.
- Add startup validation using instrumentation (runtime only, build remains credential-free).
- Gate all crawl, news, stats and CJ auth routes on a live active site user; only site login is anonymous. Preserve existing admin requirements for users.
- Create identities on local account creation in a transaction; leave future providers unimplemented.
- Run tests and typecheck; report changes for review.

## Task 3: Import and deployment
- Write failing importer tests for pagination, count mismatch, timestamp normalization and reruns.
- Create `scripts/import-supabase.ts`: runtime SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY/DATABASE_URL, all known tables, keyset pagination, preserve IDs/password hashes/JSON, fail on unknown fields rather than lose data, verify source/destination counts, repair sequences, reconcile local identities. No real source access.
- Update Dockerfile/compose/ignore files and workflows: no public DB config or build secrets; runtime validation. Provide a tools image stage for schema/import operations.
- Update `.env.example`, README and `docs/POSTGRES_MIGRATION.md` with exact commands, freeze-writes requirement, verification, rollback and no automatic deployment.

## Task 4: Verification and PR
- Run `pnpm test`, `pnpm lint`, `pnpm exec tsc --noEmit`, `pnpm build` without database credentials.
- Exercise migrations twice and importer twice on a disposable test Postgres (or compatible local test engine); do not use production data.
- Review spec first, quality second; fix findings and rerun affected checks.
- Inspect diff for secrets, backup files, client DB imports and changes to UI/export columns.
- Commit, push `refactor/phase1-postgres`, open PR to main describing env, schema/import commands and post-deploy checks. Do not merge or deploy.
