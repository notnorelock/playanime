/**
 * Google Drive provider-internal types.
 *
 * These never cross the player contract. The generic player sees
 * `PlaybackDescriptor` only — `itag` stays here.
 */

export interface GoogleDriveSource {
  readonly provider: 'google-drive';
  readonly fileId: string;
  readonly resourceKey?: string;
  readonly originalUrl: string;
}

export interface GoogleDriveStreamVariant {
  readonly src: string;
  readonly resolution?: number;
  readonly mimeType?: string;
  readonly itag?: number;
  readonly contentLength?: number;
}

export interface GoogleDrivePlaybackResult {
  readonly playerUrl: string;
  readonly useHlsByDefault: false;
  readonly streamUrls: readonly GoogleDriveStreamVariant[];
  readonly expiresAt?: Date;
  readonly durationSeconds?: number;
}

export type GoogleDriveAccess = 'public' | 'restricted' | 'unknown';

export type GoogleDriveResolveStatus =
  | 'resolved'
  | 'no_variants'
  | 'access_denied'
  | 'not_found'
  /**
   * Google is throttling playback for this file, not refusing it.
   *
   * Distinct from `not_found` because the two call for opposite responses: a
   * missing file is permanently gone, while an exhausted quota recovers on its
   * own. Collapsing them made a throttled file report as unavailable and threw
   * away the preview iframe, which still works while the quota is exhausted.
   */
  | 'rate_limited'
  | 'malformed';

export interface GoogleDriveResolveOutcome {
  readonly status: GoogleDriveResolveStatus;
  readonly playback: GoogleDrivePlaybackResult;
  readonly access: GoogleDriveAccess;
}

export interface GoogleDriveHttpResponse {
  readonly status: number;
  readonly contentType: string | null;
  readonly body: string;
}

export interface GoogleDriveFetchInit {
  readonly method?: 'GET' | 'HEAD';
  readonly headers?: Readonly<Record<string, string>>;
}

export type GoogleDriveFetch = (
  url: string,
  init?: GoogleDriveFetchInit,
) => Promise<GoogleDriveHttpResponse>;

export interface MediaLogContext {
  readonly provider?: string;
  readonly sourceId?: string;
  readonly fileId?: string;
  readonly qualities?: readonly number[];
  readonly expiresAt?: string;
  readonly status?: number;
  readonly [key: `data.${string}`]: unknown;
}

export interface MediaLogger {
  info(message: string, context?: MediaLogContext): void;
  warn(message: string, context?: MediaLogContext): void;
  error(message: string, error?: unknown, context?: MediaLogContext): void;
}

export interface GoogleDriveResolverOptions {
  readonly fetch?: GoogleDriveFetch;
  readonly logger?: MediaLogger;
  readonly now?: () => Date;
  /**
   * Public key shipped with Google Drive's own web player. Override only when
   * Google rotates the player key; this is not a PlayAnime credential.
   */
  readonly webPlayerKey?: string;
  readonly timeoutMs?: number;
}
