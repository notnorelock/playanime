/* eslint-disable no-console -- this is a CLI script; stdout is its interface */
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createDatabase } from './client/index.js';

/**
 * Migration runner.
 *
 * Deliberately a standalone script rather than something the API runs at boot:
 * with several API replicas, boot-time migration means several processes racing
 * to alter the same schema. Migration is a deployment step that runs once.
 */
const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

async function main(): Promise<void> {
  // A single connection: migrations are serial, and a pool would leave idle
  // connections holding locks if one statement fails.
  const { db, sql } = createDatabase({ maxConnections: 1 });

  console.log(`Applying migrations from ${migrationsFolder}`);

  try {
    await migrate(db, { migrationsFolder });
    console.log('Migrations applied.');
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  console.error('Migration failed:', error);
  process.exit(1);
});
