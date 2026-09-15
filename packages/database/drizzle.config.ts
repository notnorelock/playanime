import { defineConfig } from 'drizzle-kit';

/**
 * Drizzle Kit configuration.
 *
 * Reads DATABASE_URL directly rather than through @playanime/config: the CLI
 * runs outside the application bootstrap, and pulling in full environment
 * validation would make `db:generate` fail when unrelated variables are absent.
 */
const url = process.env['DATABASE_URL'];

if (url === undefined || url === '') {
  throw new Error('DATABASE_URL is required to run drizzle-kit. Copy .env.example to .env first.');
}

export default defineConfig({
  schema: './src/schema/index.ts',
  out: './src/migrations',
  dialect: 'postgresql',
  dbCredentials: { url },
  casing: 'snake_case',
  verbose: true,
  strict: true,
});
