import type { PlaybackDescriptor } from '@playanime/contracts';
import { createHash } from 'node:crypto';
import {
  UNKNOWN_EXPIRY_TTL_SECONDS,
  cacheTtlSeconds,
  isExpired,
} from '../providers/google-drive/GoogleDriveExpiration.js';
import { isLikelySignedPlaybackUrl } from '../providers/google-drive/GoogleDriveUrls.js';

/**
 * Short-lived cache for resolved playback descriptors.
 *
 * Signed media URLs are allowed here with a TTL that ends before Google's own
 * expiry. They must never be written to PostgreSQL.
 */

export interface PlaybackCacheStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
}

export interface PlaybackCacheEntry {
  readonly descriptor: PlaybackDescriptor;
  readonly cachedAt: string;
  readonly expiresAt?: string;
}

export interface PlaybackCacheOptions {
  readonly store: PlaybackCacheStore;
  readonly namespace?: string;
  readonly now?: () => Date;
}

function hashResourceKey(resourceKey: string): string {
  return createHash('sha256').update(resourceKey).digest('hex').slice(0, 16);
}

export function playbackCacheKey(
  provider: string,
  externalId: string,
  resourceKey: string | null | undefined,
  namespace = 'playanime',
): string {
  const base = `${namespace}:media:${provider}:${externalId}:playback`;
  if (resourceKey === null || resourceKey === undefined || resourceKey === '') return base;
  return `${base}:rk:${hashResourceKey(resourceKey)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseEntry(raw: string): PlaybackCacheEntry | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }

  if (!isRecord(parsed)) return null;
  if (!isRecord(parsed['descriptor'])) return null;
  if (typeof parsed['cachedAt'] !== 'string') return null;

  const expiresAt = parsed['expiresAt'];
  if (expiresAt !== undefined && typeof expiresAt !== 'string') return null;

  return {
    descriptor: parsed['descriptor'] as PlaybackDescriptor,
    cachedAt: parsed['cachedAt'],
    ...(typeof expiresAt === 'string' ? { expiresAt } : {}),
  };
}

function entryExpiresAt(entry: PlaybackCacheEntry): Date | undefined {
  if (entry.expiresAt === undefined) return undefined;
  const date = new Date(entry.expiresAt);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export class PlaybackCache {
  private readonly store: PlaybackCacheStore;
  private readonly namespace: string;
  private readonly now: () => Date;

  constructor(options: PlaybackCacheOptions) {
    this.store = options.store;
    this.namespace = options.namespace ?? 'playanime';
    this.now = options.now ?? (() => new Date());
  }

  key(provider: string, externalId: string, resourceKey?: string | null): string {
    return playbackCacheKey(provider, externalId, resourceKey, this.namespace);
  }

  async get(
    provider: string,
    externalId: string,
    resourceKey?: string | null,
  ): Promise<PlaybackDescriptor | null> {
    const key = this.key(provider, externalId, resourceKey);
    let raw: string | null;

    try {
      raw = await this.store.get(key);
    } catch {
      return null;
    }

    if (raw === null) return null;

    const entry = parseEntry(raw);
    if (entry === null) {
      await this.safeDelete(key);
      return null;
    }

    const expiresAt = entryExpiresAt(entry);
    if (expiresAt !== undefined && isExpired(expiresAt, this.now())) {
      await this.safeDelete(key);
      return null;
    }

    return entry.descriptor;
  }

  async set(
    provider: string,
    externalId: string,
    resourceKey: string | null | undefined,
    descriptor: PlaybackDescriptor,
    expiresAt?: Date,
  ): Promise<void> {
    // Never poison the cache with a failure outcome.
    if (descriptor.type === 'unavailable') return;

    const now = this.now();
    let ttl = UNKNOWN_EXPIRY_TTL_SECONDS;

    if (expiresAt !== undefined) {
      ttl = cacheTtlSeconds(expiresAt, now);
      if (ttl <= 0) return;
    }

    const entry: PlaybackCacheEntry = {
      descriptor,
      cachedAt: now.toISOString(),
      ...(expiresAt === undefined ? {} : { expiresAt: expiresAt.toISOString() }),
    };

    try {
      await this.store.set(
        this.key(provider, externalId, resourceKey),
        JSON.stringify(entry),
        ttl,
      );
    } catch {
      // Cache write failures must not break playback.
    }
  }

  async invalidate(
    provider: string,
    externalId: string,
    resourceKey?: string | null,
  ): Promise<void> {
    await this.safeDelete(this.key(provider, externalId, resourceKey));
  }

  private async safeDelete(key: string): Promise<void> {
    try {
      await this.store.del(key);
    } catch {
      // ignore
    }
  }
}

/** In-memory store for unit tests. */
export class MemoryPlaybackCacheStore implements PlaybackCacheStore {
  private readonly values = new Map<string, { value: string; expiresAt: number }>();

  get(key: string): Promise<string | null> {
    const entry = this.values.get(key);
    if (entry === undefined) return Promise.resolve(null);
    if (entry.expiresAt <= Date.now()) {
      this.values.delete(key);
      return Promise.resolve(null);
    }
    return Promise.resolve(entry.value);
  }

  set(key: string, value: string, ttlSeconds: number): Promise<void> {
    this.values.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
    return Promise.resolve();
  }

  del(key: string): Promise<void> {
    this.values.delete(key);
    return Promise.resolve();
  }
}

/**
 * Markers of a *resolved* playback URL, as opposed to stable provider identity.
 *
 * Resolved URLs are temporary and provider-signed; persisting one means serving
 * a dead link later, and storing a credential-bearing URL in a durable row.
 * Each marker names a surface that only ever appears on resolved media:
 *
 * - `hls-vod` / `live-hls` — Rumble master playlists, regenerated per request
 * - `rumble.cloud` — Rumble's CDN, whose URLs carry signed byte ranges
 * - `.m3u8` — any provider's playlist
 *
 * Stable identity (`rumble.com/embed/{id}/`, a Drive file id, a page URL) is
 * unaffected and remains persistable.
 */
const RESOLVED_PLAYBACK_MARKERS: readonly RegExp[] = [
  /\/hls-vod\//i,
  /\/live-hls(?:-dvr)?\//i,
  /\brumble\.cloud\//i,
  /\.m3u8(?:[?#]|$)/i,
];

/**
 * Guard used by persistence layers: refuse to write a resolved playback URL
 * into durable storage.
 *
 * Covers signed Drive URLs and every provider surface listed above, so the rule
 * is "persist identity, resolve playback" rather than one provider's quirk.
 */
export function assertNoSignedPlaybackUrlInPersistence(value: string, field: string): void {
  if (isLikelySignedPlaybackUrl(value)) {
    throw new Error(`Refusing to persist signed playback URL in ${field}.`);
  }

  if (RESOLVED_PLAYBACK_MARKERS.some((marker) => marker.test(value))) {
    throw new Error(`Refusing to persist resolved playback URL in ${field}.`);
  }
}
