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

/**
 * `GET /get/domain` — the current embed-domain lookup.
 *
 * The response is `{ server_time, embed_domain, status }` — confirmed
 * against the real API, not the shape an earlier version of this file
 * assumed (`old_domain`/`new_domain`, which the real endpoint never
 * returns). That mismatch made every lookup fail with
 * `BYSE_INVALID_API_RESPONSE` and silently fall back to the documented
 * default host, which is the API/docs domain, not a real embed domain.
 */
export interface ByseDomainResponse {
  readonly embedDomain: string;
}

/**
 * `GET /file/info` — source-level metadata, never anime metadata.
 *
 * Confirmed against a real response: the per-file record is nested in
 * `result[0]` (matching the docs), but its field names differ from both
 * the docs' own sample and what this file originally assumed — real
 * fields are `file_title`, `file_length`, `file_views`, `file_created`;
 * there is no `views_started` or `uploaded` at all.
 */
export interface ByseFileInfo {
  readonly status: number;
  readonly fileCode: string;
  readonly name?: string;
  /** `false` when Byse reports the file as not currently playable. */
  readonly canPlay: boolean;
  readonly views?: number;
  readonly lengthSeconds?: number;
  readonly createdAt?: string;
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
  /**
   * Enables resolving real (native) playback — source/track URLs decrypted
   * from Byse's own `/api/videos/:id/playback` — instead of only the
   * documented iframe. Off by default: this walks Byse's anti-automation
   * surface (PoW captcha, device attestation) specifically because Byse's
   * own operator authorized it for this integration; it must never be
   * turned on for a deployment that has not been separately granted that.
   */
  readonly nativePlayback?: ByseNativePlaybackOptions;
}

/**
 * Options for the native-playback (video-details API) surface.
 *
 * `origin` is deliberately not configured here — it always comes from
 * `ByseResolver.resolveEmbedDomain()`, the same rotating domain the iframe
 * embed itself uses, never a separately-configured value. If the domain
 * cannot be resolved, native playback is skipped for that call and the
 * provider falls back to the iframe, same as every other failure mode.
 */
export interface ByseNativePlaybackOptions {
  /** Auto-solve Byse's proof-of-work player check when playback requires one. */
  readonly autoSolvePowCaptcha?: boolean;
  /** Max time to spend solving a PoW challenge. Defaults to 20s, matching Byse's own client. */
  readonly powTimeoutMs?: number;
  /**
   * Persisted device-attestation fingerprint (viewer/device id + signed
   * token), reused across calls rather than re-attested every time. Backed
   * by `cache` — see `ByseResolver`'s own fingerprint cache key.
   */
  readonly attestDevice?: boolean;
}

/** `GET /api/videos/:id/details`. */
export interface ByseVideoDetails {
  readonly title?: string;
  readonly posterUrl?: string;
  readonly description: string;
  readonly ownerPrivate: boolean;
}

/** `GET /api/videos/:id/settings`. */
export interface ByseVideoSettings {
  readonly captchaRequired: boolean;
  readonly downloadAllowed?: boolean;
  readonly premiumOnly?: boolean;
}

/** A single decrypted playback variant. */
export interface BysePlaybackSource {
  readonly url: string;
  readonly quality?: string;
  readonly mimeType?: string;
  readonly bitrateKbps?: number;
  readonly height?: number;
}

/** A decrypted subtitle/caption track. */
export interface BysePlaybackTrack {
  readonly url: string;
  readonly language?: string;
  readonly title?: string;
  readonly isDefault?: boolean;
  readonly mimeType?: string;
}

export interface ByseSkipIntro {
  readonly fromSeconds: number;
  readonly toSeconds: number;
}

/** Decrypted result of `GET/POST /api/videos/:id/playback`. */
export interface BysePlayback {
  readonly sources: readonly BysePlaybackSource[];
  readonly tracks: readonly BysePlaybackTrack[];
  readonly posterUrl?: string;
  readonly skipIntro: ByseSkipIntro | null;
}

/** The AES-GCM-encrypted envelope `/playback` returns before decryption. */
export interface ByseEncryptedPlayback {
  readonly version?: string | number;
  readonly keyParts: readonly string[];
  readonly iv: string;
  readonly payload: string;
}

/** A persisted device-attestation identity, reused across `resolve()` calls. */
export interface ByseFingerprint {
  readonly viewerId?: string;
  readonly deviceId?: string;
  readonly token: string;
  readonly expiresAt?: string;
}

export interface BysePowChallenge {
  readonly nonce: string;
  readonly difficulty: number;
  readonly token: string;
}

export interface BysePowVerifyResult {
  readonly ok: boolean;
  readonly token?: string;
  readonly reason?: string;
}
