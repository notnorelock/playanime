import {
  MediaProviderId,
  ProviderEmbedPolicy,
  UnavailableReason,
  type HlsPlayback,
  type IframePlaybackFallback,
  type NativePlayback,
  type PlaybackDescriptor,
} from '@playanime/contracts';
import {
  ExternalMediaAccessDeniedError,
  ExternalMediaResolutionError,
  ExternalMediaUnavailableError,
} from '../../errors.js';
import type {
  ExternalMediaProvider,
  ExternalMediaSource,
  ParsedExternalMedia,
  PlaybackContext,
  ProviderDefinition,
  SourceAvailability,
} from '../../types/index.js';
import type { PlaybackCache } from '../../cache/PlaybackCache.js';
import { parseRumbleUrl } from './RumbleParser.js';
import { pickAdaptiveSource, toHlsVariants, toPlaybackSources } from './RumbleQualities.js';
import { RumbleResolver } from './RumbleResolver.js';
import type {
  MediaLogger,
  RumblePlaybackResult,
  RumbleResolverOptions,
} from './RumbleTypes.js';
import {
  RUMBLE_EMBED_ALLOW,
  RUMBLE_MEDIA_HOSTS,
  RUMBLE_PAGE_HOSTS,
  buildRumbleEmbedUrl,
  isRumbleEmbedId,
  isRumblePageHost,
} from './RumbleUrls.js';

/**
 * Rumble.
 *
 * Rumble publishes an embed player at `rumble.com/embed/{embedId}/` and a
 * documented oEmbed endpoint that returns the corresponding iframe markup.
 * Both are intended for third-party embedding, which is what makes this an
 * `EMBED` provider rather than a link-only one.
 *
 * ## Two different identifiers
 *
 * A Rumble page URL carries a *page slug* (`/v7fj6io-some-title.html`) while
 * the embed player takes a distinct *embed id* (`v7dctl6`). These are usually
 * different values, so the embed id is resolved through oEmbed rather than
 * derived from the slug. An `/embed/{id}/` URL supplies it directly.
 *
 * ## Playback order
 *
 * HLS first when Rumble published a master playlist — it is adaptive, it is one
 * URL, and it is what Rumble's own player uses for most videos. Progressive
 * MP4/WebM next. The official iframe last, and always attached as a fallback.
 *
 * ## Uploader and publisher control is respected
 *
 * Rumble lets an uploader disable embedding, restrict a video to Premium, or
 * limit it by region. When Rumble declines to describe a video, that decision
 * is surfaced as a restricted/unavailable state. Nothing here works around it,
 * and no viewer credentials are ever sent upstream.
 */

export const rumbleDefinition: ProviderDefinition = {
  id: MediaProviderId.RUMBLE,
  label: 'Rumble',
  hosts: [...RUMBLE_PAGE_HOSTS],
  mediaHosts: [...RUMBLE_MEDIA_HOSTS],
  embedPolicy: ProviderEmbedPolicy.EMBED,
  /**
   * Rumble's embed player exposes its playback variants to any viewer who can
   * watch the video. Emitting `native`/`hls` here reuses those same variants —
   * it decrypts nothing and bypasses no access control.
   */
  canEmitNative: true,
  // oEmbed is a documented metadata surface and a valid liveness probe. It
  // returns metadata only and never touches media bytes.
  supportsAvailabilityCheck: true,
  reliabilityWeight: 55,
};

export interface RumbleProviderOptions extends RumbleResolverOptions {
  readonly cache?: PlaybackCache;
  readonly logger?: MediaLogger;
  /**
   * When true, throw typed media errors instead of returning an unavailable
   * descriptor. The API layer uses this so status codes stay accurate.
   */
  readonly throwOnHardFailure?: boolean;
}

function iframeFallback(embedUrl: string): IframePlaybackFallback {
  return {
    type: 'iframe',
    src: embedUrl,
    allow: RUMBLE_EMBED_ALLOW,
    // Rumble's player keeps playback state against its own origin.
    requiresSameOrigin: true,
  };
}

/** The official embed player. The fallback for every unresolved case. */
function toIframeDescriptor(
  embedId: string,
  context: PlaybackContext,
): Extract<PlaybackDescriptor, { type: 'iframe' }> {
  const embed = new URL(buildRumbleEmbedUrl(embedId));
  // Rumble's documented autoplay parameter. `2` is muted autoplay, which is
  // what browsers actually permit without a gesture.
  if (context.autoplay) embed.searchParams.set('autoplay', '2');

  return {
    type: 'iframe',
    provider: MediaProviderId.RUMBLE,
    url: embed.toString(),
    allow: RUMBLE_EMBED_ALLOW,
    requiresSameOrigin: true,
    aspectRatio: 16 / 9,
  };
}

function toHlsDescriptor(
  result: RumblePlaybackResult,
  masterPlaylistUrl: string,
): HlsPlayback {
  const variants = toHlsVariants(result.sources, result.ladder);

  return {
    type: 'hls',
    provider: MediaProviderId.RUMBLE,
    src: masterPlaylistUrl,
    live: result.liveState === 'live',
    ...(variants.length === 0 ? {} : { variants }),
    ...(result.expiresAt === undefined ? {} : { expiresAt: result.expiresAt.toISOString() }),
    fallback: iframeFallback(result.embedUrl),
    aspectRatio: 16 / 9,
  };
}

function toNativeDescriptor(
  result: RumblePlaybackResult,
  sources: NativePlayback['sources'],
): NativePlayback {
  return {
    type: 'native',
    provider: MediaProviderId.RUMBLE,
    sources,
    ...(result.expiresAt === undefined ? {} : { expiresAt: result.expiresAt.toISOString() }),
    fallback: iframeFallback(result.embedUrl),
    aspectRatio: 16 / 9,
  };
}

/**
 * Rumble provider.
 *
 * Resolves stable embed identity, then adaptive or progressive playback from
 * the surfaces Rumble's own player uses, caches the result briefly, and keeps
 * the official embed as a fallback throughout.
 */
export function createRumbleProvider(
  options: RumbleProviderOptions = {},
): ExternalMediaProvider {
  const resolver = new RumbleResolver(options);
  const cache = options.cache;
  const logger = options.logger;
  const throwOnHardFailure = options.throwOnHardFailure ?? false;

  return {
    definition: rumbleDefinition,

    supports(url: URL): boolean {
      return isRumblePageHost(url.hostname);
    },

    /**
     * Parses identity without network access.
     *
     * `parse` is pure by contract, so a page URL cannot be resolved to its real
     * embed id here. The page slug is recorded as a provisional external id and
     * upgraded on first playback, where I/O is permitted. This keeps submission
     * synchronous while still converging on the correct identity.
     */
    parse(url: URL): ParsedExternalMedia | null {
      const identity = parseRumbleUrl(url);
      if (identity === null) return null;

      if (identity.embedId !== undefined) {
        return {
          provider: MediaProviderId.RUMBLE,
          externalId: identity.embedId,
          canonicalUrl: buildRumbleEmbedUrl(identity.embedId),
          displayHost: 'rumble.com',
          metadata: { identity: 'embed' },
        };
      }

      const { pageSlugId, pageUrl } = identity;
      if (pageSlugId === undefined || pageUrl === undefined) return null;

      return {
        provider: MediaProviderId.RUMBLE,
        externalId: pageSlugId,
        // The page URL is canonical here: it is what the submitter shared and
        // what oEmbed needs. It is replaced by the embed URL once the real
        // embed id is known.
        canonicalUrl: pageUrl,
        displayHost: 'rumble.com',
        metadata: { identity: 'page-slug' },
      };
    },

    async resolvePlayback(
      source: ExternalMediaSource,
      context: PlaybackContext,
    ): Promise<PlaybackDescriptor> {
      if (!isRumbleEmbedId(source.externalId)) {
        return {
          type: 'unavailable',
          provider: MediaProviderId.RUMBLE,
          reason: UnavailableReason.PROVIDER_NOT_SUPPORTED,
        };
      }

      if (cache !== undefined) {
        const cached = await cache.get(MediaProviderId.RUMBLE, source.externalId, null);
        if (cached !== null) return cached;
      }

      /**
       * A stored id may be a page slug rather than an embed id, since `parse`
       * cannot tell them apart without I/O. oEmbed settles it: if the slug is
       * not the embed id, the real one is used from here on.
       */
      let embedId = source.externalId;
      if (source.metadata['identity'] === 'page-slug') {
        /**
         * oEmbed matches on the *whole* page URL, title segment included:
         * `/v7fj6io-25-jahre-nach-911....html` resolves, while
         * `/v7fj6io.html` is a 404. So the stored canonical page URL is used
         * as-is rather than rebuilt from the slug token.
         */
        const pageUrl = rumblePageUrlOf(source);
        if (pageUrl === null) {
          return {
            type: 'unavailable',
            provider: MediaProviderId.RUMBLE,
            reason: UnavailableReason.PROVIDER_NOT_SUPPORTED,
          };
        }

        const resolved = await resolver.resolveEmbedIdentity(pageUrl);

        if (resolved === null) {
          // oEmbed declines for a removed video and for one whose owner
          // disabled embedding. Neither is something to route around.
          if (throwOnHardFailure) throw new ExternalMediaUnavailableError();
          return {
            type: 'unavailable',
            provider: MediaProviderId.RUMBLE,
            reason: UnavailableReason.UPSTREAM_UNAVAILABLE,
            fallbackUrl: source.canonicalUrl,
          };
        }

        embedId = resolved.embedId;
      }

      let outcome;
      try {
        outcome = await resolver.resolve(embedId);
      } catch (error) {
        // A transport or shape failure must not deny the viewer the official
        // player, so this degrades to the embed instead of failing.
        logger?.error('Rumble resolution failed; falling back to the embed player', error, {
          embedId,
        });
        if (throwOnHardFailure) {
          throw new ExternalMediaResolutionError(undefined, { cause: error });
        }
        return toIframeDescriptor(embedId, context);
      }

      if (outcome.status === 'access_denied') {
        if (throwOnHardFailure) throw new ExternalMediaAccessDeniedError();
        return {
          type: 'unavailable',
          provider: MediaProviderId.RUMBLE,
          reason: UnavailableReason.REQUIRES_PROVIDER_PERMISSION,
          fallbackUrl: buildRumbleEmbedUrl(embedId),
        };
      }

      if (outcome.status === 'not_found') {
        if (throwOnHardFailure) throw new ExternalMediaUnavailableError();
        return {
          type: 'unavailable',
          provider: MediaProviderId.RUMBLE,
          reason: UnavailableReason.UPSTREAM_UNAVAILABLE,
          fallbackUrl: buildRumbleEmbedUrl(embedId),
        };
      }

      const descriptor = buildPlayableDescriptor(outcome.playback, embedId, context);

      if (cache !== undefined) {
        await cache.set(
          MediaProviderId.RUMBLE,
          // Cached under the resolved embed id *and* the stored id, so a
          // page-slug source does not re-run oEmbed on every request.
          source.externalId,
          null,
          descriptor,
          outcome.playback.expiresAt,
        );
      }

      return descriptor;
    },

    /**
     * Liveness via oEmbed only.
     *
     * A 404 means the video is gone or was made private; anything else is
     * treated as "cannot tell", never as unavailable, so a transient edge error
     * does not disable a healthy source.
     */
    async checkAvailability(source: ExternalMediaSource): Promise<SourceAvailability> {
      const checkedAt = new Date();

      if (!isRumbleEmbedId(source.externalId)) {
        return { status: 'unavailable', checkedAt, detail: 'invalid_external_id' };
      }

      // Same rule as resolution: oEmbed needs the full stored page URL.
      const pageUrl =
        source.metadata['identity'] === 'page-slug'
          ? rumblePageUrlOf(source)
          : buildRumbleEmbedUrl(source.externalId);

      if (pageUrl === null) {
        return { status: 'unavailable', checkedAt, detail: 'no_page_url' };
      }

      const metadata = await resolver.resolveEmbedIdentity(pageUrl);
      if (metadata === null) {
        return { status: 'unknown', checkedAt, detail: 'oembed_no_answer' };
      }

      return { status: 'available', checkedAt };
    },
  };
}

/**
 * The stored page URL for a slug-identified source.
 *
 * Re-validated rather than trusted: a stored `canonicalUrl` is still data, and
 * this value becomes the target of an outbound request. Returns null when the
 * row does not hold a usable Rumble page URL.
 */
function rumblePageUrlOf(source: ExternalMediaSource): string | null {
  const identity = parseRumbleUrl(safeUrl(source.canonicalUrl));
  if (identity?.pageUrl !== undefined) return identity.pageUrl;

  return null;
}

function safeUrl(value: string): URL {
  try {
    return new URL(value);
  } catch {
    // A non-URL can never match a Rumble host, so this fails closed.
    return new URL('https://invalid.invalid/');
  }
}

/**
 * Chooses the descriptor for a resolved video.
 *
 * Preference order is HLS → progressive → iframe. HLS wins when present
 * because Rumble's ladder is adaptive and one playlist covers every rendition;
 * `@playanime/player`'s HLS adapter consumes the master playlist directly.
 */
function buildPlayableDescriptor(
  playback: RumblePlaybackResult,
  embedId: string,
  context: PlaybackContext,
): PlaybackDescriptor {
  const adaptive = pickAdaptiveSource(playback.sources);
  if (adaptive !== undefined) {
    return toHlsDescriptor(playback, adaptive.url);
  }

  const progressive = toPlaybackSources(playback.sources);
  if (progressive.length > 0) {
    return toNativeDescriptor(playback, progressive);
  }

  // Reachable and permitted, but nothing we can play directly: the official
  // embed is the correct answer, not an error.
  return toIframeDescriptor(embedId, context);
}

/** Default instance used by the platform registry. Cache is attached by the API. */
export const rumbleProvider = createRumbleProvider();
