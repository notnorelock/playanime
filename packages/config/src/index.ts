import { envSchema, type Env, type NodeEnv } from './schema.js';
import { loadRootEnvFile } from './load-env-file.js';

export { envSchema, NodeEnv } from './schema.js';
export type { Env } from './schema.js';
export { loadRootEnvFile } from './load-env-file.js';

/** Raised when the environment is invalid. Reported once, then the process exits. */
export class ConfigurationError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Invalid environment configuration:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
    this.name = 'ConfigurationError';
    this.issues = issues;
  }
}

/**
 * Parses and validates an environment record.
 *
 * Pure — takes the source explicitly — so tests can exercise validation without
 * mutating the real `process.env`.
 */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);

  if (!result.success) {
    throw new ConfigurationError(
      result.error.issues.map((issue) => {
        const path = issue.path.join('.') || '(root)';
        return `${path}: ${issue.message}`;
      }),
    );
  }

  return result.data;
}

let cached: Env | null = null;

/**
 * The validated environment.
 *
 * Memoized rather than module-level so importing this package has no side
 * effect: a build tool or a test can import it without a valid environment
 * present. The first real call is what enforces configuration.
 */
export function env(): Env {
  if (cached === null) {
    // Picks up the monorepo-root .env when a script runs from a package
    // directory. A no-op when the environment is already populated.
    loadRootEnvFile();
    cached = parseEnv(process.env);
  }
  return cached;
}

/**
 * Validates configuration at boot and exits on failure.
 *
 * Called from the API's bootstrap before any listener is opened, so a
 * misconfigured deployment fails immediately and visibly rather than serving
 * broken requests.
 */
export function loadEnvOrExit(): Env {
  try {
    return env();
  } catch (error) {
    if (error instanceof ConfigurationError) {
      process.stderr.write(`\n${error.message}\n\n`);
      process.exit(1);
    }
    throw error;
  }
}

/** Test seam: resets the memoized environment. */
export function resetEnvCache(): void {
  cached = null;
}

export const isProduction = (environment: NodeEnv): boolean => environment === 'production';
export const isDevelopment = (environment: NodeEnv): boolean => environment === 'development';
export const isTest = (environment: NodeEnv): boolean => environment === 'test';

/**
 * Origins permitted by CORS.
 *
 * Defaults to the web origin alone. An explicit `CORS_ORIGINS` widens it — there
 * is deliberately no wildcard option, because the API serves credentialed
 * requests and `Access-Control-Allow-Origin: *` is invalid with credentials.
 */
export function corsOrigins(config: Env): readonly string[] {
  return config.CORS_ORIGINS ?? [config.WEB_URL];
}

/** Whether logs should be human-readable. Structured JSON in production. */
export function shouldPrettyPrintLogs(config: Env): boolean {
  return config.LOG_PRETTY ?? !isProduction(config.NODE_ENV);
}
