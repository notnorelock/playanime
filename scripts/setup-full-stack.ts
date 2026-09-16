/* eslint-disable no-console -- CLI script; stdout is its interface */

/**
 * One-shot setup for a fresh clone: installs JS deps, brings up
 * Postgres/Redis, runs migrations and seed data, primes every package's
 * .env from its .env.example where one doesn't exist yet, and — unlike the
 * root `bun run setup` — also prepares services/webserver (the Go SEO/
 * preview server): `go mod download`, plus a build if a Go toolchain is
 * present. Safe to re-run: every step either no-ops or is idempotent
 * (`.env` files are never overwritten, `docker compose up -d` is a no-op on
 * already-running containers, migrations only apply what's pending).
 *
 * This does not build or start the API/web dev servers themselves — that's
 * `bun run dev` (see AGENTS.md's never-restart-without-being-asked policy;
 * this script existing doesn't change that, it just gets everything *else*
 * ready so `bun run dev` is the only thing left to run by hand).
 */

import { existsSync, copyFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');

function step(label: string): void {
  console.log(`\n\x1b[36m▸ ${label}\x1b[0m`);
}

function run(command: string, args: string[], options: { cwd?: string; optional?: boolean } = {}): boolean {
  const cwd = options.cwd ?? ROOT;
  console.log(`  $ ${command} ${args.join(' ')}${cwd !== ROOT ? `  (in ${cwd})` : ''}`);

  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });

  if (result.error !== undefined || result.status !== 0) {
    if (options.optional === true) {
      console.log(`  ⚠ skipped — ${command} not available or failed, and this step is optional`);
      return false;
    }
    console.error(`  ✗ ${command} ${args.join(' ')} failed`);
    process.exit(result.status ?? 1);
  }
  return true;
}

/** Copies .env.example to .env only if .env doesn't already exist — never overwrites. */
function primeEnv(dir: string): void {
  const example = join(dir, '.env.example');
  const target = join(dir, '.env');
  const label = dir === ROOT ? '.env' : join(dir.replace(ROOT, '').replace(/^[\\/]/, ''), '.env');

  if (!existsSync(example)) return;

  if (existsSync(target)) {
    console.log(`  • ${label} already exists, leaving it alone`);
    return;
  }

  copyFileSync(example, target);
  console.log(`  ✓ created ${label} from .env.example — review it before relying on it`);
}

step('1/6 — priming .env files (never overwrites an existing one)');
primeEnv(ROOT);
primeEnv(join(ROOT, 'packages', 'web'));
primeEnv(join(ROOT, 'services', 'webserver'));

step('2/6 — installing JS/TS dependencies (bun install)');
run('bun', ['install']);

step('3/6 — starting Postgres + Redis (docker compose up -d)');
run('bun', ['run', 'docker:up']);

step('4/6 — waiting for Postgres + Redis to accept connections');
run('bun', ['run', 'scripts/wait-for-services.ts']);

step('5/6 — running database migrations and seed data');
run('bun', ['run', 'db:migrate']);
run('bun', ['run', 'db:seed']);

step('6/6 — preparing services/webserver (Go)');
const webserverDir = join(ROOT, 'services', 'webserver');
const hasGo = run('go', ['version'], { optional: true });
if (hasGo) {
  run('go', ['mod', 'download'], { cwd: webserverDir });
  run('go', ['build', './...'], { cwd: webserverDir });
} else {
  console.log('  Go toolchain not found on PATH — install it from https://go.dev/dl/ to run');
  console.log('  services/webserver locally (bun run preview:server), or use Docker instead');
  console.log('  (docker compose --profile app up -d --build), which needs no local Go install.');
}

console.log('\n\x1b[32m✓ Setup complete.\x1b[0m');
console.log('  Next: review .env (and services/webserver/.env if you plan to run it), then:');
console.log('    bun run dev            — start the API + web dev servers');
console.log('    bun run preview        — build web and preview it through the Go server');
console.log('    docker compose --profile app up -d --build  — full containerized stack');
