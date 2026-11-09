import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE crawl_sessions
    ADD COLUMN IF NOT EXISTS pause_reason varchar(50),
    ADD COLUMN IF NOT EXISTS start_page integer,
    ADD COLUMN IF NOT EXISTS end_page integer,
    ADD COLUMN IF NOT EXISTS next_page integer,
    ADD COLUMN IF NOT EXISTS skip_existing boolean NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS idempotency_key varchar(200),
    ADD COLUMN IF NOT EXISTS recent_titles jsonb NOT NULL DEFAULT '[]',
    ADD COLUMN IF NOT EXISTS execution_id text,
    ADD COLUMN IF NOT EXISTS pending_execution jsonb,
    ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now()`.execute(db);
  // Legacy sessions do not contain an absolute range: use their relative range safely.
  await sql`UPDATE crawl_sessions SET start_page = COALESCE(start_page, 1),
    end_page = COALESCE(end_page, GREATEST(total_pages, 1)),
    next_page = COALESCE(next_page, current_page + 1)`.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS idx_crawl_idempotency ON crawl_sessions(idempotency_key, started_at DESC)`.execute(db);
  await sql`CREATE TABLE IF NOT EXISTS api_keys (
    id bigserial PRIMARY KEY,
    user_id bigint NOT NULL REFERENCES site_users(id) ON DELETE CASCADE,
    name varchar(100) NOT NULL, key_prefix varchar(16) NOT NULL UNIQUE,
    key_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
    last_used_at timestamptz, expires_at timestamptz, revoked_at timestamptz
  )`.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id)`.execute(db);
  await sql`CREATE TABLE IF NOT EXISTS mcp_audit_log (
    id bigserial PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now(),
    user_id bigint REFERENCES site_users(id) ON DELETE SET NULL, tool varchar(100) NOT NULL,
    args_redacted jsonb NOT NULL, ok boolean NOT NULL, error text,
    duration_ms integer NOT NULL, task_id bigint REFERENCES crawl_sessions(id) ON DELETE SET NULL
  )`.execute(db);
  // Also upgrades a database where an earlier revision of 002 created the audit table.
  await sql`ALTER TABLE mcp_audit_log ADD COLUMN IF NOT EXISTS api_key_id bigint REFERENCES api_keys(id) ON DELETE SET NULL`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS mcp_audit_log`.execute(db);
  await sql`DROP TABLE IF EXISTS api_keys`.execute(db);
  await sql`DROP INDEX IF EXISTS idx_crawl_idempotency`.execute(db);
  await sql`ALTER TABLE crawl_sessions DROP COLUMN pause_reason, DROP COLUMN start_page,
    DROP COLUMN end_page, DROP COLUMN next_page, DROP COLUMN skip_existing,
    DROP COLUMN idempotency_key, DROP COLUMN recent_titles, DROP COLUMN execution_id,
    DROP COLUMN pending_execution, DROP COLUMN updated_at`.execute(db);
}
