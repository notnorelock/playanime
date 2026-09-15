import { newToken } from '@playanime/shared';
import type { RedisClient } from './client.js';
import { redis } from './client.js';
import { redisKeys, redisTtl } from './keys.js';

/**
 * Advisory distributed lock.
 *
 * For work that must not run concurrently across API instances: recomputing a
 * popularity ranking, reaping stale watch parties, running a scheduled job.
 *
 * Each lock holds a random token, and release is a compare-and-delete Lua
 * script. Without that check, a holder whose work overran its TTL would delete
 * a lock that a *different* instance had since acquired.
 *
 * This is not a correctness primitive for money-like invariants — for those,
 * use a Postgres transaction. It is a coordination hint that prevents duplicate
 * work.
 */

const RELEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

const EXTEND_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('PEXPIRE', KEYS[1], ARGV[2])
end
return 0
`;

export interface LockHandle {
  readonly key: string;
  readonly token: string;
  /** Releases the lock, but only if this holder still owns it. */
  release(): Promise<boolean>;
  /** Extends the lease for long-running work. False if ownership was lost. */
  extend(ttlSeconds: number): Promise<boolean>;
}

export interface AcquireLockOptions {
  readonly ttlSeconds?: number;
  /** Retry for this long before giving up. Zero fails immediately. */
  readonly waitMs?: number;
  readonly retryIntervalMs?: number;
}

/** Attempts to acquire a lock. Returns null if it could not be taken. */
export async function acquireLock(
  name: string,
  options: AcquireLockOptions = {},
  client: RedisClient = redis(),
): Promise<LockHandle | null> {
  const key = redisKeys.lock(name);
  const token = newToken(16);
  const ttl = options.ttlSeconds ?? redisTtl.lock;
  const deadline = Date.now() + (options.waitMs ?? 0);

  for (;;) {
    const acquired = await client.set(key, token, 'EX', ttl, 'NX');

    if (acquired === 'OK') {
      return {
        key,
        token,
        async release(): Promise<boolean> {
          const result = await client.eval(RELEASE_SCRIPT, 1, key, token);
          return result === 1;
        },
        async extend(extendSeconds: number): Promise<boolean> {
          const result = await client.eval(EXTEND_SCRIPT, 1, key, token, String(extendSeconds * 1000));
          return result === 1;
        },
      };
    }

    if (Date.now() >= deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, options.retryIntervalMs ?? 50));
  }
}

/**
 * Runs `work` while holding a lock, releasing it even if the work throws.
 *
 * Returns null when the lock could not be acquired, which callers should treat
 * as "another instance is handling it" rather than as an error.
 */
export async function withLock<T>(
  name: string,
  work: () => Promise<T>,
  options: AcquireLockOptions = {},
  client: RedisClient = redis(),
): Promise<T | null> {
  const lock = await acquireLock(name, options, client);
  if (lock === null) return null;

  try {
    return await work();
  } finally {
    await lock.release();
  }
}
