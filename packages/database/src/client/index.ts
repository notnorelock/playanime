import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { env } from '@playanime/config';
import * as schema from '../schema/index.js';

/**
 * Database client.
 *
 * `postgres.js` over `node-postgres`: it is faster, has no C dependency to
 * rebuild under Bun, and supports prepared statements and pipelining natively.
 */
export type Database = PostgresJsDatabase<typeof schema>;

export interface CreateDatabaseOptions {
  readonly connectionString?: string;
  readonly maxConnections?: number;
  readonly ssl?: boolean;
  /** Overrides the pool idle timeout. Tests use a short one to exit cleanly. */
  readonly idleTimeoutSeconds?: number;
}

let client: postgres.Sql | null = null;
let database: Database | null = null;

/**
 * Builds a client and a Drizzle instance.
 *
 * Exported separately from the shared singleton so tests and scripts can open
 * an isolated connection without disturbing application state.
 */
export function createDatabase(options: CreateDatabaseOptions = {}): {
  db: Database;
  sql: postgres.Sql;
} {
  const config = env();

  const connection = postgres(options.connectionString ?? config.DATABASE_URL, {
    max: options.maxConnections ?? config.DATABASE_POOL_MAX,
    ssl: (options.ssl ?? config.DATABASE_SSL) ? 'require' : false,
    idle_timeout: options.idleTimeoutSeconds ?? 30,
    // Fail a stuck connection rather than hanging a request indefinitely.
    connect_timeout: 10,
    // Drizzle handles type mapping; postgres.js transforms would fight it.
    transform: { undefined: null },
    // Emitted through @playanime/logger by the caller, never to stdout directly.
    onnotice: () => undefined,
  });

  return {
    db: drizzle(connection, { schema, casing: 'snake_case' }),
    sql: connection,
  };
}

/**
 * The shared application database.
 *
 * Lazily constructed so importing this package has no side effect — a build
 * step or a unit test can import schema types without a live database.
 */
export function db(): Database {
  if (database === null) {
    const created = createDatabase();
    database = created.db;
    client = created.sql;
  }
  return database;
}

/** The raw client, for health checks and `LISTEN`/`NOTIFY`. */
export function rawClient(): postgres.Sql {
  if (client === null) db();
  if (client === null) throw new Error('Database client failed to initialize.');
  return client;
}

/**
 * Connectivity probe for the health endpoint.
 *
 * Runs a real query rather than checking a pool flag: a pool can report healthy
 * while the server behind it refuses queries.
 */
export async function checkDatabaseHealth(): Promise<{ healthy: boolean; latencyMs: number }> {
  const startedAt = performance.now();

  try {
    await db().execute(sql`select 1`);
    return { healthy: true, latencyMs: Math.round(performance.now() - startedAt) };
  } catch {
    return { healthy: false, latencyMs: Math.round(performance.now() - startedAt) };
  }
}

/** Closes the pool. Called on shutdown so in-flight queries can drain. */
export async function closeDatabase(): Promise<void> {
  if (client !== null) {
    await client.end({ timeout: 5 });
    client = null;
    database = null;
  }
}

export { schema };
