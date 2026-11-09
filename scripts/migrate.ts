import { getDb, closeDb } from '../src/lib/db';
import { migrate } from '../db/migrate';

async function main() {
  try { await migrate(getDb()); console.log('Database migrations complete'); }
  finally { await closeDb(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
