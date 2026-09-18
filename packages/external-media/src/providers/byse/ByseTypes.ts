import type { PlaybackCache } from '../../cache/PlaybackCache.js';

/**
 * Byse provider-internal types.
 *
 * Nothing here crosses the player contract; the rest of PlayAnime sees only
 * `PlaybackDescriptor`.
 */

/**
 * Structural logger, matching the shape every other provider in this package
 * uses so the API can pass one logger to all of them.
 */
export interface MediaLogContext {
  readonly provider?: string;
  readonly fileCode?: string;
  readonly status?: number;
  readonly [key: `data.${string}`]: unknown;
}

export interface MediaLogger {
  info(message: string, context?: MediaLogContext): void;
  warn(message: string, context?: MediaLogContext): void;
  error(message: string, error?: unknown, context?: MediaLogContext): void;
}

/** Normalized identity of a Byse resource. `fileCode` is the stable identity. */
export interface ByseSource {
  readonly provider: 'byse';
  readonly fileCode: string;
  readonly canonicalUrl: string;
}

/** A generic small-value cache, structurally identical to `PlaybackCacheStore`. */
export interface ByseKeyValueCache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
}

export type ByseFetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface ByseClientOptions {
  readonly apiBase?: string;
  readonly apiKey?: string;
  readonly fetch?: ByseFetch;
  readonly timeoutMs?: number;
  readonly logger?: MediaLogger;
}

/** `GET /get/domain` — the documented current embed-domain lookup. */
export interface ByseDomainResponse {
  readonly oldDomain: string;
  readonly newDomain: string;
}

/** `GET /file/info` — documented source-level metadata, never anime metadata. */
export interface ByseFileInfo {
  readonly status: number;
  readonly fileCode: string;
  readonly name?: string;
  /** `false` when Byse reports the file as not currently playable. */
  readonly canPlay: boolean;
  readonly viewsStarted?: number;
  readonly views?: number;
  readonly lengthSeconds?: number;
  readonly uploaded?: string;
}

/** A subtitle track to pass into the embed as a `cX_file`/`cX_label` pair. */
export interface ByseSubtitleTrack {
  readonly url: string;
  readonly label: string;
}

/** Inputs the embed URL builder accepts, beyond the bare `fileCode`. */
export interface ByseEmbedOptions {
  readonly autoplay?: boolean;
  readonly subtitles?: readonly ByseSubtitleTrack[];
  readonly posterUrl?: string;
  readonly logoUrl?: string;
}

export interface ByseProviderOptions {
  readonly apiBase?: string;
  readonly apiKey?: string;
  readonly logoUrl?: string;
  readonly fetch?: ByseFetch;
  readonly timeoutMs?: number;
  /** Cache for the resolved embed domain and for `/file/info` lookups. */
  readonly cache?: ByseKeyValueCache;
  /** Prefixes every key written to `cache`. Defaults to `'playanime'`. */
  readonly namespace?: string;
  readonly playbackCache?: PlaybackCache;
  readonly logger?: MediaLogger;
  /**
   * When true, throw typed media errors instead of returning an unavailable
   * descriptor. The API layer uses this so status codes stay accurate.
   */
  readonly throwOnHardFailure?: boolean;
  readonly now?: () => Date;
}
