import type { RedisClient } from './client.js';
import { redis } from './client.js';

/**
 * JSON cache with a stampede guard.
 *
 * `getOrSet` is the only cache API the application uses. It exists so that a
 * cache miss on a hot key does not become a thundering herd: when a popular
 * anime page expires, hundreds of concurrent requests would otherwise all miss
 * and all run the same expensive query.
 */

export interface CacheOptions {
  /** Lifetime in seconds. */
  readonly ttlSeconds: number;
  /**
   * How long a single caller may hold the recompute lock. Should exceed the
   * expected work duration, or two callers will recompute concurrently.
   */
  readonly lockTimeoutSeconds?: number;
  /** How long to wait for another caller's recompute before giving up. */
  readonly waitTimeoutMs?: number;
}

export async function cacheGet<T>(key: string, client: RedisClient = redis()): Promise<T | null> {
  const raw = await client.get(key);
  if (raw === null) return null;

  try {
    return JSON.parse(raw) as T;
  } catch {
    // A corrupt entry is discarded rather than thrown: a bad cache write must
    // not take down the read path.
    await client.del(key);
    return null;
  }
}

export async function cacheSet<T>(
  key: string,
  value: T,
  ttlSeconds: number,
  client: RedisClient = redis(),
): Promise<void> {
  await client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
}

export async function cacheDelete(
  keys: string | readonly string[],
  client: RedisClient = redis(),
): Promise<void> {
  const list = typeof keys === 'string' ? [keys] : [...keys];
  if (list.length > 0) await client.del(...list);
}

/**
 * Reads through the cache, computing on a miss.
 *
 * On a miss exactly one caller acquires a lock and computes; the others poll
 * briefly for the result. A caller that cannot acquire the lock and times out
 * computes anyway rather than failing — a slow response beats an error.
 */
export async function cacheGetOrSet<T>(
  key: string,
  options: CacheOptions,
  compute: () => Promise<T>,
  client: RedisClient = redis(),
): Promise<T> {
  const cached = await cacheGet<T>(key, client);
  if (cached !== null) return cached;

  const lockKey = `${key}:lock`;
  const lockTimeout = options.lockTimeoutSeconds ?? 10;

  // NX: only one caller wins.
  const acquired = await client.set(lockKey, '1', 'EX', lockTimeout, 'NX');

  if (acquired === 'OK') {
    try {
      const value = await compute();
      await cacheSet(key, value, options.ttlSeconds, client);
      return value;
    } finally {
      await client.del(lockKey);
    }
  }

  // Another caller is computing: poll for their result.
  const deadline = Date.now() + (options.waitTimeoutMs ?? 3_000);
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    const value = await cacheGet<T>(key, client);
    if (value !== null) return value;
  }

  // The lock holder failed or is slow. Compute rather than erroring.
  return compute();
}

/**
 * Deletes keys matching a pattern.
 *
 * Uses SCAN, never KEYS: `KEYS` blocks the single-threaded server for the whole
 * scan, which on a large keyspace is a production outage.
 */
export async function cacheInvalidatePattern(
  pattern: string,
  client: RedisClient = redis(),
): Promise<number> {
  let cursor = '0';
  let deleted = 0;

  do {
    const [next, keys] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
    cursor = next;

    if (keys.length > 0) {
      deleted += await client.del(...keys);
    }
  } while (cursor !== '0');

  return deleted;
}
