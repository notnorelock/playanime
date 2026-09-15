import type { RedisClient } from './client.js';

/**
 * Structural twin of `@playanime/external-media`'s `PlaybackCacheStore`.
 *
 * Declared here so `@playanime/redis` (tier 3) never imports a tier-4 package.
 * The shapes are identical; TypeScript's structural typing connects them at the
 * API composition root.
 */
export interface KeyValueTtlStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
}

/**
 * Redis-backed store for short-lived playback descriptors.
 *
 * Values may contain temporary signed URLs. TTL is always set by the caller
 * and must end before the signed URLs expire.
 */
export class RedisPlaybackCacheStore implements KeyValueTtlStore {
  constructor(private readonly client: RedisClient) {}

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    if (ttlSeconds <= 0) return;
    await this.client.set(key, value, 'EX', ttlSeconds);
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }
}
