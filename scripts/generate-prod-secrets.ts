/* eslint-disable no-console -- CLI script; stdout is its interface */

/**
 * Generates the random secrets infrastructure/docker/.env.prod needs
 * (POSTGRES_PASSWORD, SESSION_SECRET) and either prints them or writes them
 * straight into that file.
 *
 * There is no secrets manager in this repo — for a single VPS,
 * infrastructure/docker/.env.prod itself (gitignored, see .gitignore and
 * .env.prod.example) is the one place these values live. This script exists
 * only to generate them with real entropy; it is not a vault, and doesn't
 * pretend to be one. Treat .env.prod the way you'd treat any file with
 * plaintext credentials in it: don't email it, don't paste it into a chat
 * that isn't this one, and if you need it on a second machine, copy the
 * file directly (scp, an encrypted USB, a password manager's secure-note
 * feature) rather than retyping it anywhere.
 *
 * Usage:
 *   bun run scripts/generate-prod-secrets.ts              # print only
 *   bun run scripts/generate-prod-secrets.ts --write       # write into
 *                                                           # infrastructure/docker/.env.prod
 *                                                           # (creates it from
 *                                                           # .env.prod.example
 *                                                           # first if missing)
 */

import { existsSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const ENV_PROD_PATH = join(ROOT, 'infrastructure', 'docker', '.env.prod');
const ENV_PROD_EXAMPLE_PATH = join(ROOT, 'infrastructure', 'docker', '.env.prod.example');

/** URL-safe, no characters that need shell-quoting in a .env file or a psql connection string. */
function randomToken(bytes: number): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString('base64url');
}

const postgresPassword = randomToken(24); // 32 chars, plenty for a DB password
const sessionSecret = randomToken(48); // 64 chars, well past the 32-byte minimum schema.ts enforces

const write = process.argv.includes('--write');

if (!write) {
  console.log('POSTGRES_PASSWORD=' + postgresPassword);
  console.log('SESSION_SECRET=' + sessionSecret);
  console.log();
  console.log('Paste these into infrastructure/docker/.env.prod — replace the');
  console.log('POSTGRES_PASSWORD value, both places DATABASE_URL repeats it, and');
  console.log('SESSION_SECRET. Or re-run with --write to do this automatically.');
  process.exit(0);
}

if (!existsSync(ENV_PROD_PATH)) {
  if (!existsSync(ENV_PROD_EXAMPLE_PATH)) {
    console.error('Neither .env.prod nor .env.prod.example exists — nothing to write into.');
    process.exit(1);
  }
  copyFileSync(ENV_PROD_EXAMPLE_PATH, ENV_PROD_PATH);
  console.log('Created infrastructure/docker/.env.prod from .env.prod.example.');
}

let content = readFileSync(ENV_PROD_PATH, 'utf8');

const replacements: [pattern: RegExp, value: string][] = [
  [/^POSTGRES_PASSWORD=.*$/m, `POSTGRES_PASSWORD=${postgresPassword}`],
  [/^DATABASE_URL=postgresql:\/\/postgres:[^@]+@/m, `DATABASE_URL=postgresql://postgres:${postgresPassword}@`],
  [/^SESSION_SECRET=.*$/m, `SESSION_SECRET=${sessionSecret}`],
];

let changedCount = 0;
for (const [pattern, value] of replacements) {
  if (pattern.test(content)) {
    content = content.replace(pattern, value);
    changedCount++;
  }
}

writeFileSync(ENV_PROD_PATH, content);

console.log(`Wrote a new POSTGRES_PASSWORD and SESSION_SECRET into infrastructure/docker/.env.prod (${changedCount}/3 lines updated).`);
console.log('Still needs by hand: WEB_URL/API_URL if not playani.me, and Discord OAuth credentials if you use them.');
if (changedCount < 3) {
  console.log();
  console.log('Warning: fewer than 3 lines matched — .env.prod may already have been');
  console.log('hand-edited away from the .env.prod.example shape. Check it manually.');
}
