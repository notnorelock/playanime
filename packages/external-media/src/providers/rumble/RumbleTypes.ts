/**
 * Rumble provider-internal types.
 *
 * Nothing here crosses the player contract. The shapes of Rumble's own player
 * response (`ua.hls.auto`, `.tar` container URLs, the `live` enum) stay inside
 * this directory; the rest of PlayAnime sees only `PlaybackDescriptor`.
 */

/** Normalized identity of a Rumble resource. */
export interface RumbleSource {
  readonly provider: 'rumble';
  /**
   * The id the embed player takes. This is the stable identity PlayAnime
   * persists.
   *
   * It is frequently *not* the page slug's leading token: the page
   * `/v7fj6io-...html` embeds as `v7dctl6`. Only oEmbed (or an embed URL the
   * user supplied) yields this reliably.
   */
  readonly embedId: string;
  /**
   * Leading token of the public page slug, when the URL was a page URL.
   *
   * Kept for diagnostics and for rebuilding a human-facing link. Never used as
   * the embed id.
   */
  readonly pageSlugId?: string;
  readonly canonicalUrl: string;
}

/** Playable container formats. Ordered by how we prefer them. */
export type RumbleStreamType = 'hls' | 'mp4' | 'webm';

export interface RumblePlaybackSource {
  readonly url: string;
  readonly type: RumbleStreamType;
  /** Height in pixels. Absent when Rumble gave no usable dimensions. */
  readonly resolution?: number;
  readonly width?: number;
  readonly height?: number;
  /** Kbps, as reported. Used only for ordering and diagnostics. */
  readonly bitrate?: number;
  readonly mimeType?: string;
}

export interface RumbleSubtitle {
  readonly language: string;
  readonly label: string;
  readonly url: string;
}

/**
 * Whether the resource is a fixed-length recording or a live edge stream.
 *
 * Rumble's `live` field is an enum, not a boolean, and a value of `2` appears
 * on both an in-progress stream and its DVR replay — so this is derived from
 * `live` together with `duration` rather than from either alone.
 */
export type RumbleLiveState = 'vod' | 'live' | 'upcoming' | 'recorded_live';

/**
 * One advertised rung of an adaptive ladder.
 *
 * A label, not a source: it carries no URL, so it can never become something
 * the player tries to fetch.
 */
export interface RumbleLadderRung {
  readonly resolution: number;
  /** Kbps, as reported by Rumble. */
  readonly bitrate?: number;
}

export interface RumblePlaybackResult {
  readonly embedUrl: string;
  readonly sources: readonly RumblePlaybackSource[];
  /** Renditions advertised for an adaptive stream, highest first. */
  readonly ladder: readonly RumbleLadderRung[];
  readonly subtitles: readonly RumbleSubtitle[];
  readonly liveState: RumbleLiveState;
  /** Absent for live streams, and for VODs Rumble reported as `0`. */
  readonly durationSeconds?: number;
  readonly title?: string;
  readonly thumbnail?: string;
  readonly channel?: string;
  /** Present only when a media URL carried explicit expiry information. */
  readonly expiresAt?: Date;
}

export type RumbleResolveStatus =
  | 'resolved'
  /** Reachable and permitted, but no variant we can play natively. */
  | 'no_variants'
  /** Rumble says this viewer may not play it: private, premium, geo-blocked. */
  | 'access_denied'
  | 'not_found'
  /** Reached Rumble, but the response did not match any known shape. */
  | 'malformed';

export interface RumbleResolveOutcome {
  readonly status: RumbleResolveStatus;
  readonly playback: RumblePlaybackResult;
  /** Machine-readable detail for logs. Never rendered to a viewer. */
  readonly detail?: string;
}

export interface RumbleHttpResponse {
  readonly status: number;
  readonly contentType: string | null;
  readonly body: string;
  /** Final URL after redirects, so SSRF checks can be re-applied. */
  readonly url?: string;
}

export interface RumbleFetchInit {
  readonly method?: 'GET' | 'HEAD';
  readonly headers?: Readonly<Record<string, string>>;
}

export type RumbleFetch = (
  url: string,
  init?: RumbleFetchInit,
) => Promise<RumbleHttpResponse>;

export interface RumbleResolverOptions {
  readonly fetch?: RumbleFetch;
  readonly logger?: MediaLogger;
  readonly now?: () => Date;
  readonly timeoutMs?: number;
  /** Hard cap on a provider response body. Guards against a hostile payload. */
  readonly maxResponseBytes?: number;
}

/**
 * Structural logger, matching the Google Drive provider's contract so the API
 * can pass one logger to every provider.
 */
export interface MediaLogContext {
  readonly provider?: string;
  readonly sourceId?: string;
  readonly embedId?: string;
  readonly formats?: readonly string[];
  readonly qualities?: readonly number[];
  readonly subtitles?: number;
  readonly live?: boolean;
  readonly status?: number;
  readonly expiresAt?: string;
  readonly [key: `data.${string}`]: unknown;
}

export interface MediaLogger {
  info(message: string, context?: MediaLogContext): void;
  warn(message: string, context?: MediaLogContext): void;
  error(message: string, error?: unknown, context?: MediaLogContext): void;
}
