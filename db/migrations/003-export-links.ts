import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`CREATE TABLE IF NOT EXISTS export_links (
    id bigserial PRIMARY KEY,
    user_id bigint NOT NULL REFERENCES site_users(id) ON DELETE CASCADE,
    api_key_id bigint REFERENCES api_keys(id) ON DELETE SET NULL,
    kind text NOT NULL CHECK (kind IN ('news', 'crawl_history')),
    params jsonb NOT NULL CHECK (jsonb_typeof(params) = 'object'),
    token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
    token_prefix varchar(8) NOT NULL,
    row_count integer NOT NULL CHECK (row_count BETWEEN 1 AND 20000),
    file_name text NOT NULL,
    expires_at timestamptz NOT NULL,
    download_count integer NOT NULL DEFAULT 0 CHECK (download_count >= 0 AND download_count <= max_downloads),
    max_downloads integer NOT NULL DEFAULT 3 CHECK (max_downloads > 0),
    created_at timestamptz NOT NULL DEFAULT now()
  )`.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS idx_export_links_expires_at ON export_links(expires_at)`.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS idx_export_links_user_id ON export_links(user_id)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS export_links`.execute(db);
}
