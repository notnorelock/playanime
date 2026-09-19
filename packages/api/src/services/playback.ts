import { and, eq } from 'drizzle-orm';
import {
  PLAYABLE_SOURCE_STATUSES,
  UnavailableReason,
  type EpisodeSourceDto,
  type EpisodeSourceListResponse,
  type PlaybackDescriptor,
  type SourcePlaybackResponse,
} from '@playanime/contracts';
import { db } from '@playanime/database';
import { episodeSources } from '@playanime/database/schema';
import {
  PlaybackCache,
  assertNoSignedPlaybackUrlInPersistence,
  createDefaultRegistry,
  parseSubmittedUrl,
  rankSources,
  type ExternalMediaSource,
  type PlaybackContext,
  type ProviderRegistry,
} from '@playanime/external-media';
import { redis, RedisPlaybackCacheStore, redisNamespace } from '@playanime/redis';
import { NotFoundError, ErrorCode, isUuid } from '@playanime/shared';
import { createLogger, type Logger } from '@playanime/logger';
import { env } from '@playanime/config';

/**
 * Episode source and playback services.
 *
 * Route handlers stay thin: they validate params and call into this module.
 * Google Drive parsing never lives in a route file.
 */

export interface PlaybackServices {
  readonly registry: ProviderRegistry;
  readonly cache: PlaybackCache;
  readonly logger: Logger;
}

export function createPlaybackServices(logger: Logger = createLogger({ name: 'api' })): PlaybackServices {
  const config = env();
  const cache = new PlaybackCache({
    store: new RedisPlaybackCacheStore(redis()),
    namespace: redisNamespace(config.REDIS_NAMESPACE),
  });

  const mediaLogger = {
    info: (message: string, context?: Record<string, unknown>) => {
      logger.info(message, sanitizeLogContext(context));
    },
    warn: (message: string, context?: Record<string, unknown>) => {
      logger.warn(message, sanitizeLogContext(context));
    },
    error: (message: string, error?: unknown, context?: Record<string, unknown>) => {
      logger.error(message, error, sanitizeLogContext(context));
    },
  };

  const registry = createDefaultRegistry({
    playbackCache: cache,
    logger: mediaLogger,
    throwOnHardFailure: true,
    byse: {
      ...(config.BYSE_API_BASE === undefined ? {} : { apiBase: config.BYSE_API_BASE }),
      ...(config.BYSE_API_KEY === undefined ? {} : { apiKey: config.BYSE_API_KEY }),
      ...(config.BYSE_EMBED_LOGO_URL === undefined ? {} : { logoUrl: config.BYSE_EMBED_LOGO_URL }),
      // Reuses the same Redis-backed key/value store as the playback cache —
      // it is already exactly the `get`/`set`/`del`-with-TTL shape Byse's
      // resolver needs for its resolved-domain and file-info lookups, just
      // keyed under a different namespace than a playback descriptor.
      cache: new RedisPlaybackCacheStore(redis()),
      namespace: redisNamespace(config.REDIS_NAMESPACE),
      ...(config.BYSE_NATIVE_PLAYBACK_ENABLED
        ? {
            nativePlayback: {
              autoSolvePowCaptcha: config.BYSE_AUTO_SOLVE_POW_CAPTCHA,
              attestDevice: config.BYSE_ATTEST_DEVICE,
            },
          }
        : {}),
    },
  });

  return { registry, cache, logger };
}

/**
 * Media URLs carry signatures and byte ranges, and are long enough to bloat
 * logs on their own. Anything that looks like one is replaced before it reaches
 * a log sink, whichever provider produced it.
 */
const MEDIA_URL_MARKERS = [
  'videoplayback', // Google Drive / googlevideo
  'sig=',
  'signature=',
  'rumble.cloud', // Rumble CDN, incl. signed r_range parameters
  'r_range=',
  '.m3u8',
];

function sanitizeLogContext(
  context: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (context === undefined) return undefined;
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    if (typeof value === 'string' && MEDIA_URL_MARKERS.some((marker) => value.includes(marker))) {
      next[key] = '[redacted-media-url]';
      continue;
    }
    next[key] = value;
  }
  return next;
}

function toExternalSource(row: typeof episodeSources.$inferSelect): ExternalMediaSource {
  assertNoSignedPlaybackUrlInPersistence(row.canonicalUrl, 'episode_sources.canonical_url');
  assertNoSignedPlaybackUrlInPersistence(row.originalUrl, 'episode_sources.original_url');

  return {
    id: row.id,
    provider: row.provider,
    externalId: row.externalId,
    resourceKey: row.resourceKey,
    canonicalUrl: row.canonicalUrl,
    audioLanguage: row.audioLanguage,
    subtitleLanguage: row.subtitleLanguage,
    qualityHint: row.qualityHint,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
  };
}

function toSourceDto(
  row: typeof episodeSources.$inferSelect,
  registry: ProviderRegistry,
): EpisodeSourceDto {
  return {
    id: row.id,
    provider: row.provider,
    displayHost: (() => {
      try {
        return new URL(row.canonicalUrl).hostname.replace(/^www\./, '');
      } catch {
        return row.provider;
      }
    })(),
    kind: row.kind,
    audioLanguage: row.audioLanguage,
    subtitleLanguage: row.subtitleLanguage,
    qualityHint: row.qualityHint,
    isVerified: row.isVerified,
    canEmbed: registry.canEmbed(row.provider),
    availability: row.availability,
    addedAt: row.createdAt.toISOString(),
  };
}

export async function listEpisodeSources(
  episodeId: string,
  services: PlaybackServices,
): Promise<EpisodeSourceListResponse> {
  if (!isUuid(episodeId)) {
    throw new NotFoundError('Episode could not be found.', { code: ErrorCode.EPISODE_NOT_FOUND });
  }

  const rows = await db()
    .select()
    .from(episodeSources)
    .where(
      and(
        eq(episodeSources.episodeId, episodeId),
        eq(episodeSources.status, 'active'),
      ),
    );

  const ranked = rankSources(
    rows.map((row) => ({
      id: row.id,
      provider: row.provider,
      isVerified: row.isVerified,
      availability: row.availability,
      audioLanguage: row.audioLanguage,
      subtitleLanguage: row.subtitleLanguage,
      qualityHint: row.qualityHint,
      priority: row.priority,
      failureCount: row.failureCount,
    })),
    { preferredAudioLanguage: null, preferredSubtitleLanguage: null },
    services.registry,
  );

  const byId = new Map(rows.map((row) => [row.id, row]));
  const sources = ranked
    .map((entry) => byId.get(entry.id))
    .filter((row): row is typeof episodeSources.$inferSelect => row !== undefined)
    .map((row) => toSourceDto(row, services.registry));

  return {
    episodeId,
    sources,
    recommendedSourceId: sources[0]?.id ?? null,
  };
}

export async function resolveSourcePlayback(
  sourceId: string,
  context: PlaybackContext,
  services: PlaybackServices,
  options: { refresh?: boolean } = {},
): Promise<SourcePlaybackResponse> {
  if (!isUuid(sourceId)) {
    throw new NotFoundError('Source could not be found.', { code: ErrorCode.SOURCE_NOT_FOUND });
  }

  const [row] = await db()
    .select()
    .from(episodeSources)
    .where(eq(episodeSources.id, sourceId))
    .limit(1);

  if (row === undefined) {
    throw new NotFoundError('Source could not be found.', { code: ErrorCode.SOURCE_NOT_FOUND });
  }

  if (!PLAYABLE_SOURCE_STATUSES.includes(row.status)) {
    const reason =
      row.status === 'pending'
        ? UnavailableReason.SOURCE_PENDING_REVIEW
        : row.status === 'rejected'
          ? UnavailableReason.SOURCE_REJECTED
          : row.status === 'disabled'
            ? UnavailableReason.SOURCE_DISABLED
            : row.status === 'blocked'
              ? UnavailableReason.SOURCE_BLOCKED
              : row.status === 'removed'
                ? UnavailableReason.SOURCE_REMOVED
                : row.status === 'copyright_claim'
                  ? UnavailableReason.COPYRIGHT_CLAIM
                  : UnavailableReason.UPSTREAM_UNAVAILABLE;

    const descriptor = services.registry.unavailable(row.provider, reason, row.canonicalUrl);
    return {
      sourceId: row.id,
      episodeId: row.episodeId,
      descriptor,
      resolvedAt: new Date().toISOString(),
    };
  }

  if (options.refresh === true) {
    await services.cache.invalidate(row.provider, row.externalId, row.resourceKey);
  }

  const descriptor: PlaybackDescriptor = await services.registry.resolvePlayback(
    toExternalSource(row),
    context,
  );

  return {
    sourceId: row.id,
    episodeId: row.episodeId,
    descriptor,
    resolvedAt: new Date().toISOString(),
  };
}

export async function resolveEpisodePlayback(
  episodeId: string,
  context: PlaybackContext,
  services: PlaybackServices,
  sourceId?: string,
): Promise<SourcePlaybackResponse> {
  const listing = await listEpisodeSources(episodeId, services);
  const selected =
    sourceId !== undefined
      ? listing.sources.find((source) => source.id === sourceId)
      : listing.sources.find((source) => source.id === listing.recommendedSourceId) ?? listing.sources[0];

  if (selected === undefined) {
    throw new NotFoundError('No playable source is available for this episode.', {
      code: ErrorCode.SOURCE_NOT_FOUND,
    });
  }

  return resolveSourcePlayback(selected.id, context, services);
}

export function previewSourceUrl(url: string, services: PlaybackServices) {
  const parsedUrl = parseSubmittedUrl(url);
  const parsed = services.registry.parse(parsedUrl);
  return {
    provider: parsed.provider,
    normalizedUrl: parsed.canonicalUrl,
    displayHost: parsed.displayHost,
    canEmbed: services.registry.canEmbed(parsed.provider),
  };
}
