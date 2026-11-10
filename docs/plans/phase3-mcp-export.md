# Phase 3 MCP Export Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Expose existing news/crawl-history exports and export history through MCP, delivering bounded workbooks through short-lived bearer download links.

**Architecture:** A shared server-only export service owns columns, workbook formatting, bounded queries and history helpers. A database-backed link service stores only token hashes and validated parameters; public downloads reserve a download atomically before generating in memory. MCP retains existing authentication/audit semantics and adds strict schemas and a shared per-key export bucket.

**Tech Stack:** Next.js, TypeScript, Kysely/PostgreSQL, PGlite, xlsx, Zod, official MCP SDK, node:test.

## Task 1 — Shared workbook service and Web regression
- Create `src/lib/export-service.ts`; modify news/crawl export and export-history routes, `news-service.ts` as necessary.
- Export column definitions/defaults, EXPORT_MAX_ROWS=20000, typed errors, `buildNewsWorkbook(params, columns, db?)`, `buildCrawlHistoryWorkbook(params, columns, db?)`, count helpers and shared history recording/list helpers.
- Count before loading data and bound fetching against growth; preserve filters, date-only exclusive next-day boundary, file names, column order/widths and existing Web history semantics. Explicit Asia/Shanghai cell formatting; cancelled -> 已取消.
- Write `tests/export-service.test.ts` / `tests/export-web.test.ts` first, run with `node --conditions=react-server --import tsx --test tests/export-*.test.ts`, observe missing/new behavior failure; implement and rerun. Read workbooks with XLSX to verify data/default columns/status/time.
- Review spec compliance then code quality before next dependent task.

## Task 2 — Persisted bearer downloads
- Add migration `003-export-links`, Database table typing, `src/lib/export-links.ts`, public `src/app/api/exports/download/[token]/route.ts`.
- Add tests first for migration reruns, SHA-256-only storage, unknown/expired/disabled credentials, headers, XLSX data, fourth download rejection and concurrent attempts.
- Service count validates 1..20000 without generating workbook at creation; save params/columns and metadata; news history inserted once at creation transactionally with link. Random token is 32 bytes, fixed format validation before DB lookup, hash comparison via timingSafeEqual. Every download atomically checks active owner, expiry and count while reserving a slot; rejected cases uniform 404. Generate in memory with stored params; no disk writes or token logging.
- TTL 30 minutes, max_downloads=3; cleanup expiry older than 24h at creation; PUBLIC_BASE_URL default https://spider.wakaja.top. Validate base URL to avoid credentials/unsupported schemes. No-store and no-referrer on public responses; RFC5987 filename.

## Task 3 — MCP integration
- Extend `src/lib/mcp/schemas.ts`, `security.ts`, `handler.ts`; add `tests/mcp-export.test.ts` with real SDK and PGlite.
- Strict inputs reject unknown fields, invalid/descending dates and unknown columns; deduplicate columns and append content_text only when requested. Preserve six-column Web news default and four-column crawl default.
- Three tools: export_news, export_crawl_history, list_export_history. All active roles allowed; existing nine tools unchanged. Export shared bucket=5/minute per API key and total bucket=60. Chinese tool descriptions state expiry/download limits and delivery instructions.
- Map only typed export errors to explicit Chinese results; generic errors must not leak DB details. Audit validated filter/column metadata only, never token or URL. Result dates +08:00. History listing keeps existing global Web visibility, no deletion tool.
- Test happy paths, zero/overflow, validation, member permissions, role disable, audit/log secrecy and bucket isolation/refill.

## Task 4 — Documentation, verification and delivery
- Update docs/MCP.md and .env.example (placeholder only), migration/deployment instructions without executing deployment.
- Run `pnpm install --frozen-lockfile`, `pnpm test`, `pnpm lint`, `pnpm typecheck`, `env -u JWT_SECRET -u DATABASE_URL -u CJ_USERNAME -u CJ_PASSWORD pnpm build`, `git diff --check`.
- Independent spec review then security/logic review; fix findings and rerun checks.
- Stage explicit allowlisted paths, inspect staged changes for secrets/.env/.bak, commit only after verification. Push only feat/phase3-mcp-export (`git push -u origin HEAD`), create PR to main, watch pushed-SHA CI, report link. Do not merge, push main or deploy.

## Reporting checkpoints
1. Main baseline/plan and branch ready.
2. Shared service/Web regression complete.
3. Downloads and MCP integration complete.
4. Verification and PR ready.
