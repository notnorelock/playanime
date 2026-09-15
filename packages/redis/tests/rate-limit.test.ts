import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { createRedis } from '../src/client.js';
import { consumeRateLimit, resetRateLimit, type RateLimitRule } from '../src/rate-limit.js';
import { acquireLock, withLock } from '../src/lock.js';
import { cacheGetOrSet, cacheGet, cacheDelete } from '../src/cache.js';

/**
 * Integration tests against a live Redis.
 *
 * These exercise Lua atomicity and TTL behaviour, which cannot be verified
 * against a mock — the bugs these prevent (races between concurrent callers,
 * locks deleted by the wrong owner) only appear in the real server.
 */
const client = createRedis({ lazyConnect: false });

const rule: RateLimitRule = { scope: 'test-scope', limit: 3, windowMs: 1_000 };

beforeEach(async () => {
  await resetRateLimit(rule, 'subject-1', client);
  await cacheDelete(['test:cache:key', 'test:cache:key:lock'], client);
});

afterAll(async () => {
  await client.quit();
});

describe('sliding-window rate limit', () => {
  it('allows requests up to the limit', async () => {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const result = await consumeRateLimit(rule, 'subject-1', client);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(3 - attempt);
    }
  });

  it('blocks the request past the limit and reports a retry delay', async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await consumeRateLimit(rule, 'subject-1', client);
    }

    const blocked = await consumeRateLimit(rule, 'subject-1', client);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('isolates subjects from one another', async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await consumeRateLimit(rule, 'subject-1', client);
    }

    const other = await consumeRateLimit(rule, 'subject-2', client);
    expect(other.allowed).toBe(true);

    await resetRateLimit(rule, 'subject-2', client);
  });

  it('admits requests again once the window slides past', async () => {
    const fastRule: RateLimitRule = { scope: 'test-fast', limit: 2, windowMs: 300 };
    await resetRateLimit(fastRule, 'subject-1', client);

    await consumeRateLimit(fastRule, 'subject-1', client);
    await consumeRateLimit(fastRule, 'subject-1', client);
    expect((await consumeRateLimit(fastRule, 'subject-1', client)).allowed).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 350));
    expect((await consumeRateLimit(fastRule, 'subject-1', client)).allowed).toBe(true);

    await resetRateLimit(fastRule, 'subject-1', client);
  });

  it('counts concurrent requests atomically', async () => {
    // Ten simultaneous requests against a limit of three must yield exactly
    // three allowances. A non-atomic implementation lets several through.
    const results = await Promise.all(
      Array.from({ length: 10 }, () => consumeRateLimit(rule, 'subject-1', client)),
    );

    expect(results.filter((result) => result.allowed)).toHaveLength(3);
  });

  it('clears an allowance on reset', async () => {
    await consumeRateLimit(rule, 'subject-1', client);
    await resetRateLimit(rule, 'subject-1', client);

    const result = await consumeRateLimit(rule, 'subject-1', client);
    expect(result.remaining).toBe(2);
  });
});

describe('distributed lock', () => {
  it('grants the lock to exactly one of several contenders', async () => {
    const handles = await Promise.all(
      Array.from({ length: 5 }, () => acquireLock('test-lock', { ttlSeconds: 5 }, client)),
    );

    const held = handles.filter((handle) => handle !== null);
    expect(held).toHaveLength(1);

    const winner = held[0];
    if (winner !== undefined) await winner.release();
  });

  it('refuses release from a holder that no longer owns the lock', async () => {
    const first = await acquireLock('test-lock-2', { ttlSeconds: 5 }, client);
    expect(first).not.toBeNull();

    // Simulate the lock expiring and being taken by another instance.
    await client.set(first!.key, 'someone-elses-token', 'EX', 5);

    expect(await first!.release()).toBe(false);
    await client.del(first!.key);
  });

  it('releases the lock even when the work throws', async () => {
    let thrown: unknown;
    try {
      await withLock('test-lock-3', () => Promise.reject(new Error('boom')), { ttlSeconds: 5 }, client);
    } catch (error: unknown) {
      thrown = error;
    }

    expect((thrown as Error).message).toBe('boom');

    // The lock must be free for the next caller.
    const next = await acquireLock('test-lock-3', { ttlSeconds: 5 }, client);
    expect(next).not.toBeNull();
    if (next !== null) await next.release();
  });

  it('returns null rather than waiting when the lock is held', async () => {
    const first = await acquireLock('test-lock-4', { ttlSeconds: 5 }, client);
    const second = await withLock('test-lock-4', () => Promise.resolve('ran'), {}, client);

    expect(second).toBeNull();
    if (first !== null) await first.release();
  });
});

describe('cache', () => {
  it('computes on a miss and serves the cached value afterwards', async () => {
    let computeCount = 0;
    const compute = (): Promise<string> => {
      computeCount += 1;
      return Promise.resolve('value');
    };

    const first = await cacheGetOrSet('test:cache:key', { ttlSeconds: 10 }, compute, client);
    const second = await cacheGetOrSet('test:cache:key', { ttlSeconds: 10 }, compute, client);

    expect(first).toBe('value');
    expect(second).toBe('value');
    expect(computeCount).toBe(1);
  });

  it('computes once under concurrent misses', async () => {
    let computeCount = 0;
    const compute = async (): Promise<string> => {
      computeCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 100));
      return 'shared';
    };

    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        cacheGetOrSet('test:cache:key', { ttlSeconds: 10 }, compute, client),
      ),
    );

    expect(results.every((value) => value === 'shared')).toBe(true);
    // The stampede guard must keep this well below the caller count.
    expect(computeCount).toBe(1);
  });

  it('discards a corrupt entry rather than throwing', async () => {
    await client.set('test:cache:key', 'not valid json{');
    expect(await cacheGet('test:cache:key', client)).toBeNull();
  });
});
