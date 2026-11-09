import type { Kysely } from 'kysely';
import { Migrator } from 'kysely/migration';
import * as initial from './migrations/001-initial';

/** Versioned, transactional migrations with Kysely's PostgreSQL advisory lock. */
export async function migrate<T>(db: Kysely<T>): Promise<void> {
  const migrator = new Migrator({ db, provider: { async getMigrations() { return { '001-initial': initial }; } } });
  const { error } = await migrator.migrateToLatest();
  if (error) throw error;
}
