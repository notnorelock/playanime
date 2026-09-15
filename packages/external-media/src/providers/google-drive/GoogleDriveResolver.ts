import type {
  GoogleDrivePlaybackResult,
  GoogleDriveResolveOutcome,
  GoogleDriveResolverOptions,
  GoogleDriveStreamVariant,
  MediaLogger,
} from './GoogleDriveTypes.js';
import { GoogleDriveClient } from './GoogleDriveClient.js';
import { earliestExpiration } from './GoogleDriveExpiration.js';
import {
  looksLikeAccessDeniedPage,
  looksLikeNotFoundPage,
  parseGoogleApiError,
  parsePlaybackApiBody,
  parseVideoInfoBody,
  parseViewerHtml,
} from './GoogleDriveParser.js';
import { buildGoogleDrivePreviewUrl } from './GoogleDriveUrls.js';

const silentLogger: MediaLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

function playbackResult(
  playerUrl: string,
  streams: readonly GoogleDriveStreamVariant[],
  extras: { durationSeconds?: number } = {},
): GoogleDrivePlaybackResult {
  const expiresAt = earliestExpiration(streams.map((stream) => stream.src));

  return {
    playerUrl,
    useHlsByDefault: false,
    streamUrls: streams,
    ...(expiresAt === undefined ? {} : { expiresAt }),
    ...(extras.durationSeconds === undefined ? {} : { durationSeconds: extras.durationSeconds }),
  };
}

function parseJsonBody(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Resolves the playback variants the Google Drive web player exposes for a
 * file the current (anonymous or resource-key) viewer can already access.
 *
 * Order matches the live player:
 * 1. workspacevideo-pa `/playback` JSON (current Drive web player)
 * 2. `get_video_info` form body (legacy player)
 * 3. documented `fmt_stream_map` fields in the preview HTML
 *
 * Access control is Google's. A 403/404 is surfaced, never bypassed. Signed
 * `videoplayback` URLs are returned to the caller for short-lived use only.
 */
export class GoogleDriveResolver {
  private readonly client: GoogleDriveClient;
  private readonly logger: MediaLogger;

  constructor(options: GoogleDriveResolverOptions = {}) {
    this.client = new GoogleDriveClient(options);
    this.logger = options.logger ?? silentLogger;
  }

  async resolve(fileId: string, resourceKey?: string): Promise<GoogleDriveResolveOutcome> {
    const playerUrl = buildGoogleDrivePreviewUrl(fileId, resourceKey);

    const fromApi = await this.resolveFromPlaybackApi(fileId, resourceKey, playerUrl);
    if (fromApi?.status === 'resolved') return fromApi;
    if (fromApi?.status === 'access_denied' || fromApi?.status === 'not_found') return fromApi;

    const fromInfo = await this.resolveFromVideoInfo(fileId, resourceKey, playerUrl);
    if (fromInfo?.status === 'resolved') return fromInfo;
    if (fromInfo?.status === 'access_denied' || fromInfo?.status === 'not_found') {
      return fromInfo;
    }

    const fromHtml = await this.resolveFromPreviewHtml(fileId, resourceKey, playerUrl);
    if (fromHtml !== undefined) return fromHtml;

    if (fromApi !== undefined) return fromApi;
    if (fromInfo !== undefined) return fromInfo;

    this.logger.warn('Google Drive playback resolved without variants', { fileId });
    return {
      status: 'no_variants',
      access: 'unknown',
      playback: playbackResult(playerUrl, []),
    };
  }

  private async resolveFromPlaybackApi(
    fileId: string,
    resourceKey: string | undefined,
    playerUrl: string,
  ): Promise<GoogleDriveResolveOutcome | undefined> {
    let response;
    try {
      response = await this.client.fetchPlaybackApi(fileId, resourceKey);
    } catch (error) {
      this.logger.warn('Google Drive playback API request failed', { fileId });
      this.logger.error('Google Drive playback API transport error', error, { fileId });
      return undefined;
    }

    const parsedJson = parseJsonBody(response.body);

    if (response.status === 401 || response.status === 403) {
      this.logger.info('Google Drive playback API denied access', { fileId, status: response.status });
      return {
        status: 'access_denied',
        access: 'restricted',
        playback: playbackResult(playerUrl, []),
      };
    }

    if (response.status === 404) {
      const apiError = parseGoogleApiError(parsedJson);
      this.logger.info('Google Drive playback API reported not found', {
        fileId,
        status: response.status,
        ...(apiError?.status === undefined ? {} : { 'data.status': apiError.status }),
      });
      return {
        status: 'not_found',
        access: 'unknown',
        playback: playbackResult(playerUrl, []),
      };
    }

    if (response.status < 200 || response.status >= 300 || parsedJson === undefined) {
      this.logger.warn('Google Drive playback API returned an unexpected response', {
        fileId,
        status: response.status,
      });
      return {
        status: 'malformed',
        access: 'unknown',
        playback: playbackResult(playerUrl, []),
      };
    }

    const parsed = parsePlaybackApiBody(parsedJson);
    if (parsed === undefined) {
      return {
        status: 'malformed',
        access: 'unknown',
        playback: playbackResult(playerUrl, []),
      };
    }

    if (parsed.streams.length === 0) {
      return {
        status: 'no_variants',
        access: 'public',
        playback: playbackResult(
          playerUrl,
          [],
          parsed.durationSeconds === undefined ? {} : { durationSeconds: parsed.durationSeconds },
        ),
      };
    }

    const playback = playbackResult(
      playerUrl,
      parsed.streams,
      parsed.durationSeconds === undefined ? {} : { durationSeconds: parsed.durationSeconds },
    );
    this.logger.info('Google Drive playback resolved', {
      fileId,
      qualities: parsed.streams.map((stream) => stream.resolution).filter((value): value is number => value !== undefined),
      ...(playback.expiresAt === undefined ? {} : { expiresAt: playback.expiresAt.toISOString() }),
    });

    return { status: 'resolved', access: 'public', playback };
  }

  private async resolveFromVideoInfo(
    fileId: string,
    resourceKey: string | undefined,
    playerUrl: string,
  ): Promise<GoogleDriveResolveOutcome | undefined> {
    let response;
    try {
      response = await this.client.fetchVideoInfo(fileId, resourceKey);
    } catch (error) {
      this.logger.error('Google Drive get_video_info transport error', error, { fileId });
      return undefined;
    }

    if (response.status === 401 || response.status === 403) {
      return {
        status: 'access_denied',
        access: 'restricted',
        playback: playbackResult(playerUrl, []),
      };
    }

    if (response.status === 404) {
      return {
        status: 'not_found',
        access: 'unknown',
        playback: playbackResult(playerUrl, []),
      };
    }

    if (response.status < 200 || response.status >= 300) {
      return undefined;
    }

    const parsed = parseVideoInfoBody(response.body);

    if (parsed.status === 'fail') {
      const reason = (parsed.reason ?? '').toLowerCase();
      const denied =
        reason.includes('access') ||
        reason.includes('permission') ||
        reason.includes('login') ||
        reason.includes('private');

      return {
        status: denied ? 'access_denied' : 'not_found',
        access: denied ? 'restricted' : 'unknown',
        playback: playbackResult(playerUrl, []),
      };
    }

    if (parsed.streams.length === 0) {
      return {
        status: 'no_variants',
        access: 'public',
        playback: playbackResult(
          playerUrl,
          [],
          parsed.durationSeconds === undefined ? {} : { durationSeconds: parsed.durationSeconds },
        ),
      };
    }

    const playback = playbackResult(
      playerUrl,
      parsed.streams,
      parsed.durationSeconds === undefined ? {} : { durationSeconds: parsed.durationSeconds },
    );    this.logger.info('Google Drive playback resolved', {
      fileId,
      qualities: parsed.streams
        .map((stream) => stream.resolution)
        .filter((value): value is number => value !== undefined),
      ...(playback.expiresAt === undefined ? {} : { expiresAt: playback.expiresAt.toISOString() }),
    });

    return { status: 'resolved', access: 'public', playback };
  }

  private async resolveFromPreviewHtml(
    fileId: string,
    resourceKey: string | undefined,
    playerUrl: string,
  ): Promise<GoogleDriveResolveOutcome | undefined> {
    let response;
    try {
      response = await this.client.fetchPreviewPage(playerUrl, fileId, resourceKey);
    } catch (error) {
      this.logger.error('Google Drive preview page transport error', error, { fileId });
      return undefined;
    }

    if (response.status === 401 || response.status === 403) {
      return {
        status: 'access_denied',
        access: 'restricted',
        playback: playbackResult(playerUrl, []),
      };
    }

    if (response.status === 404 || looksLikeNotFoundPage(response.body)) {
      return {
        status: 'not_found',
        access: 'unknown',
        playback: playbackResult(playerUrl, []),
      };
    }

    if (response.status < 200 || response.status >= 300) return undefined;

    if (looksLikeAccessDeniedPage(response.body)) {
      return {
        status: 'access_denied',
        access: 'restricted',
        playback: playbackResult(playerUrl, []),
      };
    }

    const streams = parseViewerHtml(response.body);
    if (streams.length === 0) {
      return {
        status: 'no_variants',
        access: 'public',
        playback: playbackResult(playerUrl, []),
      };
    }

    const playback = playbackResult(playerUrl, streams);
    this.logger.info('Google Drive playback resolved', {
      fileId,
      qualities: streams
        .map((stream) => stream.resolution)
        .filter((value): value is number => value !== undefined),
      ...(playback.expiresAt === undefined ? {} : { expiresAt: playback.expiresAt.toISOString() }),
    });

    return { status: 'resolved', access: 'public', playback };
  }
}
