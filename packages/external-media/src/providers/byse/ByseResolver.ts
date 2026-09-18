import { ByseApi } from './ByseApi.js';
import { ByseError } from './ByseErrors.js';
import type {
  ByseFileInfo,
  ByseKeyValueCache,
  ByseProviderOptions,
  MediaLogger,
} from './ByseTypes.js';

/**
 * Optional Byse API enhancements: current embed domain, file health/metadata.
 *
 * Everything here is additive. Basic iframe playback never depends on any of
 * it — every method degrades to "nothing learned" rather than throwing, and
 * the provider always has the documented default embed URL to fall back on.
 */

/** Reasonable TTL for a value Byse itself expects to change occasionally. */
const DOMAIN_CACHE_TTL_SECONDS = 60 * 60 * 6;
const FILE_INFO_CACHE_TTL_SECONDS = 60 * 10;

const silentLogger: MediaLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

export class ByseResolver {
  private readonly api: ByseApi;
  private readonly cache: ByseKeyValueCache | undefined;
  private readonly logger: MediaLogger;
  private readonly hasApiKey: boolean;
  /**
   * Prefixes every cache key, matching `PlaybackCache`'s own `namespace`
   * option — the shared cache backing this (see `RedisPlaybackCacheStore` at
   * the API composition root) applies no namespacing on its own, so without
   * this two environments sharing one Redis instance would collide on the
   * exact same "external-media:byse:domain" key.
   */
  private readonly namespace: string;

  constructor(options: ByseProviderOptions = {}) {
    this.api = new ByseApi(options);
    this.cache = options.cache;
    this.logger = options.logger ?? silentLogger;
    this.hasApiKey = options.apiKey !== undefined;
    this.namespace = options.namespace ?? 'playanime';
  }

  private domainCacheKey(): string {
    return `${this.namespace}:external-media:byse:domain`;
  }

  private fileInfoCacheKey(fileCode: string): string {
    return `${this.namespace}:external-media:byse:file:${fileCode}`;
  }

  /**
   * The currently trusted embed domain, or `undefined` when no key is
   * configured, nothing is cached yet, and the live lookup fails or is
   * skipped. Never throws.
   */
  async resolveEmbedDomain(): Promise<string | undefined> {
    if (!this.hasApiKey) return undefined;

    const domainCacheKey = this.domainCacheKey();
    if (this.cache !== undefined) {
      try {
        const cached = await this.cache.get(domainCacheKey);
        if (cached !== null) return cached;
      } catch {
        // A cache read failure just means falling through to a live lookup.
      }
    }

    try {
      const result = await this.api.getDomain();
      if (this.cache !== undefined) {
        await this.cache
          .set(domainCacheKey, result.newDomain, DOMAIN_CACHE_TTL_SECONDS)
          .catch(() => undefined);
      }
      return result.newDomain;
    } catch (error) {
      this.logger.warn('Byse embed-domain lookup failed; using the documented default', {
        provider: 'byse',
        'data.reason': error instanceof ByseError ? error.reason : 'unknown',
      });
      return undefined;
    }
  }

  /**
   * Documented source-level metadata for a file code, or `undefined` when no
   * key is configured or the lookup fails. Never throws — health/metadata is
   * an enhancement, and one failed lookup must not disable a source (see
   * `checkAvailability` in `ByseProvider`, which treats `undefined` as
   * "unknown", not "unavailable").
   */
  async fileInfo(fileCode: string): Promise<ByseFileInfo | undefined> {
    if (!this.hasApiKey) return undefined;

    const cacheKey = this.fileInfoCacheKey(fileCode);
    if (this.cache !== undefined) {
      try {
        const cached = await this.cache.get(cacheKey);
        if (cached !== null) return JSON.parse(cached) as ByseFileInfo;
      } catch {
        // Malformed cache entry: fall through to a live lookup.
      }
    }

    try {
      const info = await this.api.getFileInfo(fileCode);
      if (this.cache !== undefined) {
        await this.cache
          .set(cacheKey, JSON.stringify(info), FILE_INFO_CACHE_TTL_SECONDS)
          .catch(() => undefined);
      }
      return info;
    } catch (error) {
      this.logger.warn('Byse file-info lookup failed', {
        provider: 'byse',
        fileCode,
        'data.reason': error instanceof ByseError ? error.reason : 'unknown',
      });
      return undefined;
    }
  }
}
