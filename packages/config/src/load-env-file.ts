import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/**
 * Loads the monorepo-root `.env` into `process.env`.
 *
 * Bun loads a `.env` from the current working directory automatically, but
 * `bun run --filter` executes each script with the *package* directory as cwd.
 * One env file at the repository root is far better than twelve copies, so this
 * walks upward to find it.
 *
 * Existing values always win: a variable exported in the shell or injected by a
 * container orchestrator must not be silently overridden by a checked-out file.
 */

/** Walks up from `startDir` looking for the workspace root. */
function findRepoRoot(startDir: string): string | null {
  let current = resolve(startDir);

  for (let depth = 0; depth < 10; depth += 1) {
    // The root package.json is the one declaring workspaces.
    const candidate = join(current, 'package.json');
    if (existsSync(candidate)) {
      try {
        const parsed: unknown = JSON.parse(readFileSync(candidate, 'utf8'));
        if (
          typeof parsed === 'object' &&
          parsed !== null &&
          'workspaces' in parsed &&
          parsed.workspaces !== undefined
        ) {
          return current;
        }
      } catch {
        // Unreadable package.json: keep walking rather than failing.
      }
    }

    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return null;
}

/**
 * Minimal `.env` parser.
 *
 * Deliberately not a dependency: the format handled here is `KEY=value`,
 * `#` comments, and optional surrounding quotes. Anything more elaborate
 * belongs in a real secret manager, not a file in the repository.
 */
function parseEnvFile(contents: string): Record<string, string> {
  const result: Record<string, string> = {};

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) continue;

    const separator = line.indexOf('=');
    if (separator <= 0) continue;

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();

    // Strip matching surrounding quotes, preserving inner ones.
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }

    result[key] = value;
  }

  return result;
}

let loaded = false;

/**
 * Loads the root `.env` once per process. Safe to call from any entry point.
 *
 * Returns the path loaded, or null when no file was found — a missing `.env` is
 * not an error, because production supplies configuration through the
 * environment directly.
 */
export function loadRootEnvFile(startDir: string = process.cwd()): string | null {
  if (loaded) return null;
  loaded = true;

  const root = findRepoRoot(startDir);
  if (root === null) return null;

  const envPath = join(root, '.env');
  if (!existsSync(envPath)) return null;

  const parsed = parseEnvFile(readFileSync(envPath, 'utf8'));

  for (const [key, value] of Object.entries(parsed)) {
    // Never override what the environment already provides.
    process.env[key] ??= value;
  }

  return envPath;
}
