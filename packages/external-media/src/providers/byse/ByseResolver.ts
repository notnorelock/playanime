import { ByseApi } from './ByseApi.js';
import { ByseError } from './ByseErrors.js';
import {
  computeByseServerCanvasHash,
  generateByseDeviceKeypair,
  signByseChallenge,
} from './ByseAttestation.js';
import { decryptBysePlayback } from './BysePlaybackCrypto.js';
import { solveBysePow } from './BysePow.js';
import { ByseVideoApi } from './ByseVideoApi.js';
import type {
  BysePlayback,
  BysePlaybackFingerprint,
  BysePlaybackSource,
  BysePlaybackTrack,
  ByseFetch,
  ByseFileInfo,
  ByseFingerprint,
  ByseKeyValueCache,
  ByseNativePlaybackOptions,
  ByseProviderOptions,
  MediaLogger,
} from './ByseTypes.js';

/**
 * Reduces a cached attestation identity to the exact shape `POST /playback`
 * expects — confirmed against the real client bundle. `expires_at` exists
 * only to decide when the *cached* identity should be renewed
 * (`deviceFingerprint`'s own concern) and is never sent here; including it
 * makes Byse's server reject the request outright with 400 "invalid request
 * body".
 */
function toPlaybackFingerprint(fingerprint: ByseFingerprint): BysePlaybackFingerprint {
  return {
    viewer_id: fingerprint.viewerId,
    device_id: fingerprint.deviceId,
    token: fingerprint.token,
    confidence: fingerprint.confidence,
  };
}

/**
 * Optional Byse API enhancements: current embed domain, file health/metadata,
 * and (when explicitly enabled — see `ByseNativePlaybackOptions`) native
 * playback resolution through Byse's own video-details API.
 *
 * The iframe-only path never depends on any of it — every method degrades to
 * "nothing learned" rather than throwing, and the provider always has the
 * documented default embed URL to fall back on.
 */

/** Reasonable TTL for a value Byse itself expects to change occasionally. */
const DOMAIN_CACHE_TTL_SECONDS = 60 * 60 * 6;
const FILE_INFO_CACHE_TTL_SECONDS = 60 * 10;
/** A device-attestation identity is meant to persist across many videos, not be re-earned per call. */
const FINGERPRINT_CACHE_TTL_SECONDS = 60 * 60 * 24 * 14;
const DEFAULT_POW_TIMEOUT_MS = 20_000;

const silentLogger: MediaLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

interface StoredFingerprint extends ByseFingerprint {
  readonly privateKeyJwk: JsonWebKey;
}

export class ByseResolver {
  private readonly api: ByseApi;
  private readonly cache: ByseKeyValueCache | undefined;
  private readonly logger: MediaLogger;
  private readonly hasApiKey: boolean;
  private readonly nativeOptions: ByseNativePlaybackOptions | undefined;
  private readonly fetchImpl: ByseFetch | undefined;
  private readonly timeoutMs: number | undefined;
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
    this.nativeOptions = options.nativePlayback;
    // Propagated to every `ByseVideoApi` this resolver constructs — without
    // this, a caller-supplied `fetch` (tests, or a future non-default
    // runtime) silently never reaches the native-playback surface at all,
    // which always fell back to its own default (the real global `fetch`)
    // instead. Caught by a test that mocked `fetch` and found every native-
    // playback request hitting the real network unmocked.
    this.fetchImpl = options.fetch;
    this.timeoutMs = options.timeoutMs;
  }

  private domainCacheKey(): string {
    return `${this.namespace}:external-media:byse:domain`;
  }

  private fileInfoCacheKey(fileCode: string): string {
    return `${this.namespace}:external-media:byse:file:${fileCode}`;
  }

  private fingerprintCacheKey(): string {
    return `${this.namespace}:external-media:byse:fingerprint`;
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
          .set(domainCacheKey, result.embedDomain, DOMAIN_CACHE_TTL_SECONDS)
          .catch(() => undefined);
      }
      return result.embedDomain;
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

  /**
   * Resolves real playback (decrypted source/track URLs) for a file code, or
   * `undefined` when native playback is not enabled, the embed domain cannot
   * be resolved, or resolution fails for any reason — every case falls back
   * to the iframe descriptor in `ByseProvider`, exactly like every other
   * enhancement here.
   *
   * Flow: resolve domain -> getSettings -> obtain/reuse a fingerprint (if
   * `attestDevice`) -> POST/GET /playback. A 428 `{"error":"captcha_required"}`
   * from that call — and only that exact shape, never any other 4xx/5xx — is
   * caught specifically and retried exactly once with a freshly solved
   * captcha token (when `autoSolvePowCaptcha` is on); any other failure, or a
   * second captcha requirement on the retry, propagates to the outer catch
   * and falls back to the iframe. `settings.captchaRequired` is logged but
   * never gates this — a real production request needed the retry even
   * though settings had not predicted it, so only the live /playback
   * response is treated as authoritative.
   *
   * `X-Embed-Origin`/`X-Embed-Referer` are set to Byse's own resolved embed
   * domain (the same `/get/domain` result the request itself targets), not
   * PlayAnime's site origin — this mirrors what the documented iframe embed
   * itself sends when framed on that domain.
   */
  async nativePlayback(fileCode: string): Promise<BysePlayback | undefined> {
    if (this.nativeOptions === undefined) return undefined;

    const domain = await this.resolveEmbedDomain();
    if (domain === undefined) return undefined;

    const domainOrigin = `https://${domain}`;

    const videoApi = new ByseVideoApi({
      origin: domainOrigin,
      embedParentHost: domain,
      embedParentReferrer: domainOrigin,
      logger: this.logger,
      ...(this.fetchImpl === undefined ? {} : { fetch: this.fetchImpl }),
      ...(this.timeoutMs === undefined ? {} : { timeoutMs: this.timeoutMs }),
    });

    try {
      const fingerprint = this.nativeOptions.attestDevice === true ? await this.deviceFingerprint(videoApi) : undefined;
      const fingerprintWire = fingerprint === undefined ? undefined : toPlaybackFingerprint(fingerprint);

      // `details` is the only source of `fileId` (the numeric identifier the
      // heartbeat needs — see `ByseVideoDetails.fileId`'s doc). Fetched
      // alongside settings since neither depends on the other.
      const [details, settings] = await Promise.all([
        videoApi.getDetails(fileCode),
        videoApi.getSettings(fileCode),
      ]);
      // Settings' own `captchaRequired` is advisory metadata, kept for
      // logging/future use — it is not what decides whether a captcha is
      // actually solved. The real playback response is authoritative: only
      // an actual 428 {"error":"captcha_required"} from /playback itself
      // triggers the retry below, per a real production case where settings
      // did not predict the requirement but /playback still demanded one.
      this.logger.info('Byse settings resolved', {
        provider: 'byse',
        fileCode,
        'data.settingsCaptchaRequired': settings.captchaRequired,
      });

      let playback: BysePlayback | undefined;
      try {
        playback = await this.fetchAndDecryptPlayback(videoApi, fileCode, {
          ...(fingerprintWire === undefined ? {} : { fingerprint: fingerprintWire }),
        });
      } catch (error) {
        if (!(error instanceof ByseError) || error.reason !== 'BYSE_CAPTCHA_REQUIRED') throw error;
        if (this.nativeOptions.autoSolvePowCaptcha !== true) throw error;

        // The exact retry the spec calls for: discard whatever token was in
        // play (there was none on this first attempt — a captcha is only
        // ever ATTACHED starting on retry, never carried in from a previous
        // call, so this is really "obtain one for the first time"), solve
        // fresh, retry /playback exactly once. A second BYSE_CAPTCHA_REQUIRED
        // (or any other failure) on the retry propagates to the outer catch
        // and falls back to the iframe — this file only ever attempts one
        // retry, never loops.
        this.logger.info('Byse playback requires captcha; refreshing captcha token', {
          provider: 'byse',
          fileCode,
        });

        const captchaToken = await this.solvePowCaptcha(videoApi, fileCode);
        if (captchaToken === undefined) throw error;

        playback = await this.fetchAndDecryptPlayback(videoApi, fileCode, {
          captchaToken,
          ...(fingerprintWire === undefined ? {} : { fingerprint: fingerprintWire }),
        });
      }

      if (playback === undefined) return undefined;
      return details.fileId === undefined ? playback : { ...playback, fileId: details.fileId };
    } catch (error) {
      this.logger.warn('Byse native playback resolution failed; falling back to the embed', {
        provider: 'byse',
        fileCode,
        'data.reason': error instanceof ByseError ? error.reason : 'unknown',
      });
      return undefined;
    }
  }

  /** Fetches and decrypts one playback envelope. Returns `undefined` (not throw) on decrypt/shape failure. */
  private async fetchAndDecryptPlayback(
    videoApi: ByseVideoApi,
    fileCode: string,
    options: { captchaToken?: string; fingerprint?: BysePlaybackFingerprint },
  ): Promise<BysePlayback | undefined> {
    const raw = await videoApi.getPlayback(fileCode, options);
    if (raw.encrypted === null) return undefined;

    let decoded: unknown;
    try {
      decoded = await decryptBysePlayback(raw.encrypted);
    } catch (error) {
      this.logger.warn('Byse playback envelope failed to decrypt', {
        provider: 'byse',
        fileCode,
        'data.reason': error instanceof Error ? error.message : 'unknown',
      });
      return undefined;
    }

    return normalizeDecryptedPlayback(decoded, raw.skipIntro);
  }

  /** Runs the PoW challenge/solve/verify loop once. Returns `undefined` (not throw) on any step failing. */
  private async solvePowCaptcha(videoApi: ByseVideoApi, fileCode: string): Promise<string | undefined> {
    const challenge = await videoApi.startPowCaptcha(fileCode);
    if (challenge.nonce.length === 0 || challenge.token.length === 0) return undefined;

    const solution = await solveBysePow(
      challenge.nonce,
      challenge.difficulty,
      this.nativeOptions?.powTimeoutMs ?? DEFAULT_POW_TIMEOUT_MS,
    );
    if (solution === null) return undefined;

    const verified = await videoApi.verifyPowCaptcha(fileCode, challenge.token, solution);
    return verified.ok ? verified.token : undefined;
  }

  /**
   * The persisted device-attestation identity, attesting fresh (and caching
   * the result) when none is cached yet. Returns `undefined` — never throws —
   * on any failure, since this is an optional enhancement to the playback
   * request, not a precondition for it.
   */
  private async deviceFingerprint(videoApi: ByseVideoApi): Promise<ByseFingerprint | undefined> {
    const cacheKey = this.fingerprintCacheKey();

    if (this.cache !== undefined) {
      try {
        const cached = await this.cache.get(cacheKey);
        if (cached !== null) return JSON.parse(cached) as StoredFingerprint;
      } catch {
        // Malformed cache entry: fall through to attesting fresh.
      }
    }

    try {
      const keypair = await generateByseDeviceKeypair();
      const challenge = await videoApi.getDeviceChallenge();
      const signature = await signByseChallenge(keypair.privateKey, challenge.nonce);

      let canvasHash: string | undefined;
      try {
        canvasHash = await computeByseServerCanvasHash();
      } catch {
        // Canvas rendering is best-effort — see `ByseAttestation`'s own doc.
      }

      // `client` field names are exact, confirmed against the real client
      // bundle — notably `color_depth`, not `screen_color_depth` — see
      // ByseTypes.ts's `ByseFingerprint` doc. Only `user_agent`/`canvas_hash`
      // are populated: every other field (screen size, UA-CH, WebGL/audio
      // hashes) describes a real browser's environment, which this
      // server-side integration has no way to observe and must not invent.
      const attested = await videoApi.attestDevice({
        viewer_id: '',
        device_id: '',
        challenge_id: challenge.challengeId,
        nonce: challenge.nonce,
        signature,
        public_key: keypair.publicKeyJwk,
        client: {
          user_agent: 'PlayAnimeByseIntegration/1.0',
          ...(canvasHash === undefined ? {} : { canvas_hash: canvasHash }),
        },
        storage: {},
        attributes: { entropy: 'low' },
      });

      const fingerprint: StoredFingerprint = {
        viewerId: attested.viewer_id,
        deviceId: attested.device_id,
        token: attested.token,
        confidence: attested.confidence,
        expiresAt: attested.expires_at,
        privateKeyJwk: keypair.privateKeyJwk,
      };

      if (this.cache !== undefined) {
        await this.cache
          .set(cacheKey, JSON.stringify(fingerprint), FINGERPRINT_CACHE_TTL_SECONDS)
          .catch(() => undefined);
      }

      return fingerprint;
    } catch (error) {
      this.logger.warn('Byse device attestation failed', {
        provider: 'byse',
        'data.reason': error instanceof ByseError ? error.reason : 'unknown',
      });
      return undefined;
    }
  }
}

/** Byse never documents this shape — every field is read defensively, never assumed present. */
function normalizeDecryptedPlayback(
  decoded: unknown,
  skipIntro: BysePlayback['skipIntro'],
): BysePlayback | undefined {
  if (decoded === null || typeof decoded !== 'object') return undefined;
  const record = decoded as Record<string, unknown>;

  const sources = Array.isArray(record['sources'])
    ? record['sources'].flatMap((raw): BysePlaybackSource[] => {
        if (raw === null || typeof raw !== 'object') return [];
        const item = raw as Record<string, unknown>;
        const url = item['url'];
        if (typeof url !== 'string' || url.length === 0) return [];

        return [
          {
            url,
            ...(typeof item['quality'] === 'string' ? { quality: item['quality'] } : {}),
            ...(typeof item['mime_type'] === 'string' ? { mimeType: item['mime_type'] } : {}),
            ...(typeof item['bitrate_kbps'] === 'number' ? { bitrateKbps: item['bitrate_kbps'] } : {}),
            ...(typeof item['height'] === 'number' ? { height: item['height'] } : {}),
          },
        ];
      })
    : [];

  if (sources.length === 0) return undefined;

  const tracks = Array.isArray(record['tracks'])
    ? record['tracks'].flatMap((raw): BysePlaybackTrack[] => {
        if (raw === null || typeof raw !== 'object') return [];
        const item = raw as Record<string, unknown>;
        const url = item['url'];
        if (typeof url !== 'string' || url.length === 0) return [];

        return [
          {
            url,
            ...(typeof item['language'] === 'string' ? { language: item['language'] } : {}),
            ...(typeof item['title'] === 'string' ? { title: item['title'] } : {}),
            ...(typeof item['default'] === 'boolean' ? { isDefault: item['default'] } : {}),
            ...(typeof item['mime_type'] === 'string' ? { mimeType: item['mime_type'] } : {}),
          },
        ];
      })
    : [];

  return {
    sources,
    tracks,
    ...(typeof record['poster_url'] === 'string' ? { posterUrl: record['poster_url'] } : {}),
    skipIntro,
  };
}

