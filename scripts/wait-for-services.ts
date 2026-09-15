/* eslint-disable no-console -- CLI script; stdout is its interface */

/**
 * Blocks until Postgres and Redis accept connections.
 *
 * `docker compose up -d` returns as soon as containers start, not when the
 * services inside them are ready. Running migrations immediately after it fails
 * intermittently — which looks like a flaky setup rather than a race, so it
 * tends to get retried rather than fixed.
 */

const TIMEOUT_MS = 60_000;
const INTERVAL_MS = 500;

interface Target {
  readonly name: string;
  readonly host: string;
  readonly port: number;
}

/** Parses host and port out of a connection URL, with a sensible fallback. */
function parseTarget(name: string, url: string | undefined, defaultPort: number): Target {
  if (url === undefined) {
    return { name, host: '127.0.0.1', port: defaultPort };
  }

  try {
    const parsed = new URL(url);
    return {
      name,
      // localhost resolves to ::1 first on Windows, where these services bind
      // IPv4 only. Normalizing avoids a confusing connection refusal.
      host: parsed.hostname === 'localhost' ? '127.0.0.1' : parsed.hostname,
      port: parsed.port === '' ? defaultPort : Number.parseInt(parsed.port, 10),
    };
  } catch {
    return { name, host: '127.0.0.1', port: defaultPort };
  }
}

/** Opens a TCP connection to check the port is accepting. */
async function isReachable(target: Target): Promise<boolean> {
  try {
    const socket = await Bun.connect({
      hostname: target.host,
      port: target.port,
      socket: { data: () => undefined },
    });
    socket.end();
    return true;
  } catch {
    return false;
  }
}

async function waitFor(target: Target): Promise<void> {
  const deadline = Date.now() + TIMEOUT_MS;
  process.stdout.write(`Waiting for ${target.name} (${target.host}:${String(target.port)})…`);

  while (Date.now() < deadline) {
    if (await isReachable(target)) {
      console.log(' ready');
      return;
    }
    process.stdout.write('.');
    await Bun.sleep(INTERVAL_MS);
  }

  console.log(' timed out');
  throw new Error(
    `${target.name} did not become reachable within ${String(TIMEOUT_MS / 1000)}s. ` +
      'Is Docker running? Try: bun run docker:up',
  );
}

const targets: readonly Target[] = [
  parseTarget('PostgreSQL', process.env['DATABASE_URL'], 5432),
  parseTarget('Redis', process.env['REDIS_URL'], 6379),
];

try {
  for (const target of targets) {
    await waitFor(target);
  }
  console.log('\nAll services ready.');
} catch (error: unknown) {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
