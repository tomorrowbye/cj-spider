import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  const statements = `
    SET LOCAL TIME ZONE 'Asia/Shanghai';
    CREATE TABLE news (
      id bigserial PRIMARY KEY, source_id varchar(20) NOT NULL UNIQUE, title varchar(500) NOT NULL,
      content text, content_text text, summary text, author varchar(100), source_name varchar(100),
      region varchar(50), category varchar(50), tags text[], view_count integer DEFAULT 0,
      share_count integer DEFAULT 0, images jsonb, qr_codes jsonb, contact_info jsonb, related_links jsonb,
      source_url varchar(500), publish_time timestamptz, crawl_time timestamptz,
      status varchar(20) NOT NULL DEFAULT 'pending', error_message text, raw_html text,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE crawl_sessions (
      id bigserial PRIMARY KEY, session_name varchar(100), total_pages integer NOT NULL DEFAULT 0,
      current_page integer NOT NULL DEFAULT 0, total_news integer NOT NULL DEFAULT 0,
      crawled_news integer NOT NULL DEFAULT 0, failed_news integer NOT NULL DEFAULT 0,
      pending_news integer NOT NULL DEFAULT 0, phase varchar(20) NOT NULL DEFAULT 'list',
      avg_speed double precision NOT NULL DEFAULT 0, status varchar(20) NOT NULL DEFAULT 'running',
      started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz
    );
    CREATE TABLE site_users (
      id bigserial PRIMARY KEY, username varchar(100) NOT NULL UNIQUE, password_hash text NOT NULL,
      role varchar(20) NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
      is_active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(), last_login_at timestamptz
    );
    CREATE TABLE auth_identities (
      id bigserial PRIMARY KEY, user_id bigint NOT NULL REFERENCES site_users(id) ON DELETE CASCADE,
      provider varchar(100) NOT NULL, provider_subject text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(provider, provider_subject), UNIQUE(user_id, provider)
    );
    CREATE TABLE export_history (
      id bigserial PRIMARY KEY, keyword text, author text, region text, source_name text,
      start_date timestamptz, end_date timestamptz, total_count integer NOT NULL,
      columns text[] NOT NULL, file_name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE crawl_tasks (
      id bigserial PRIMARY KEY, task_type varchar(20) NOT NULL, target_url varchar(500) NOT NULL,
      page_num integer, news_source_id varchar(20), status varchar(20) DEFAULT 'pending',
      retry_count integer DEFAULT 0, error_message text, created_at timestamptz DEFAULT now(), completed_at timestamptz
    );
    CREATE TABLE login_sessions (
      id bigserial PRIMARY KEY, cookies text, user_agent varchar(500), is_valid boolean DEFAULT true,
      created_at timestamptz DEFAULT now(), expires_at timestamptz
    );
    CREATE INDEX idx_news_region ON news(region);
    CREATE INDEX idx_news_category ON news(category);
    CREATE INDEX idx_news_source_name ON news(source_name);
    CREATE INDEX idx_news_publish_time ON news(publish_time);
    CREATE INDEX idx_news_status ON news(status);
    CREATE INDEX idx_news_created_at ON news(created_at);
    CREATE INDEX idx_news_tags ON news USING gin(tags);
    CREATE INDEX idx_crawl_sessions_started_at ON crawl_sessions(started_at);
    CREATE INDEX idx_export_history_created_at ON export_history(created_at);
    CREATE INDEX idx_crawl_tasks_status ON crawl_tasks(status);
    CREATE INDEX idx_crawl_tasks_type ON crawl_tasks(task_type);
    CREATE OR REPLACE FUNCTION update_updated_at() RETURNS trigger AS $$
      BEGIN NEW.updated_at = now(); RETURN NEW; END;
    $$ LANGUAGE plpgsql;
    CREATE TRIGGER news_updated_at BEFORE UPDATE ON news FOR EACH ROW EXECUTE FUNCTION update_updated_at();
    CREATE TRIGGER site_users_updated_at BEFORE UPDATE ON site_users FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  `;
  // Keep function bodies intact; execute one statement per prepared query for pg/PGlite.
  for (const statement of statements.split(/;\s*(?=CREATE|$)/).filter(s => s.trim())) {
    await sql.raw(statement).execute(db);
  }
}
export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE auth_identities, export_history, login_sessions, crawl_tasks, crawl_sessions, news, site_users`.execute(db);
  await sql`DROP FUNCTION update_updated_at()`.execute(db);
}
