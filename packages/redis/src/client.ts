import Redis from 'ioredis';
import { env } from '@playanime/config';

/**
 * Redis client.
 *
 * Lazy singleton, matching the database package: importing this module has no
 * side effect until `redis()` is called.
 */

export type RedisClient = Redis;

export interface CreateRedisOptions {
  readonly url?: string;
  readonly namespace?: string;
  readonly lazyConnect?: boolean;
}

let client: Redis | null = null;

export function createRedis(options: CreateRedisOptions = {}): Redis {
  const config = env();
  return new Redis(options.url ?? config.REDIS_URL, {
    lazyConnect: options.lazyConnect ?? true,
    maxRetriesPerRequest: 2,
    enableReadyCheck: true,
  });
}

export function redis(): Redis {
  client ??= createRedis();
  return client;
}

export async function checkRedisHealth(): Promise<{ healthy: boolean; latencyMs: number }> {
  const startedAt = performance.now();
  try {
    await redis().ping();
    return { healthy: true, latencyMs: Math.round(performance.now() - startedAt) };
  } catch {
    return { healthy: false, latencyMs: Math.round(performance.now() - startedAt) };
  }
}

export async function closeRedis(): Promise<void> {
  if (client !== null) {
    await client.quit();
    client = null;
  }
}

export function redisNamespace(configNamespace?: string): string {
  return configNamespace ?? env().REDIS_NAMESPACE;
}

/**
 * Namespaced key helper. Every key in the platform goes through this so
 * environments can share one Redis instance safely.
 */
export function namespacedKey(parts: readonly string[], namespace = redisNamespace()): string {
  return [namespace, ...parts].join(':');
}
