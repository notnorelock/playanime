import {
  MediaProviderId,
  ProviderEmbedPolicy,
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
} from '../../types/index.js';
import type { PlaybackCache } from '../../cache/PlaybackCache.js';
import { GoogleDriveResolver } from './GoogleDriveResolver.js';
import {
  assertValidGoogleDriveIdentity,
  parseGoogleDriveUrl,
  toCanonicalGoogleDriveUrl,
} from './GoogleDriveParser.js';
import type {
  GoogleDrivePlaybackResult,
  GoogleDriveResolverOptions,
  MediaLogger,
} from './GoogleDriveTypes.js';
import {
  GOOGLE_DRIVE_PREVIEW_ALLOW,
  buildGoogleDrivePreviewUrl,
  isGoogleDrivePageHost,
} from './GoogleDriveUrls.js';

export const googleDriveDefinition: ProviderDefinition = {
  id: MediaProviderId.GOOGLE_DRIVE,
  label: 'Google Drive',
  hosts: ['drive.google.com', 'docs.google.com', 'drive.usercontent.google.com'],
  embedPolicy: ProviderEmbedPolicy.EMBED,
  mediaHosts: ['drive.google.com', 'docs.google.com', 'googlevideo.com'],
  /**
   * Drive's web player exposes temporary progressive transcodes for files the
   * viewer can already open. Emitting `native` here means reusing those
   * variants — not inventing access, not decrypting DRM, and not proxying bytes.
   */
  canEmitNative: true,
  supportsAvailabilityCheck: true,
  reliabilityWeight: 60,
};

export interface GoogleDriveProviderOptions extends GoogleDriveResolverOptions {
  readonly cache?: PlaybackCache;
  readonly logger?: MediaLogger;
  /**
   * When true, throw typed media errors instead of returning an unavailable
   * descriptor. The API layer uses this so status codes stay accurate.
   */
  readonly throwOnHardFailure?: boolean;
}

function iframeFallback(playerUrl: string): NonNullable<NativePlayback['fallback']> {
  return {
    type: 'iframe',
    src: playerUrl,
    allow: GOOGLE_DRIVE_PREVIEW_ALLOW,
    requiresSameOrigin: true,
  };
}

function toNativeDescriptor(
  result: GoogleDrivePlaybackResult,
): Extract<PlaybackDescriptor, { type: 'native' }> {
  return {
    type: 'native',
    provider: MediaProviderId.GOOGLE_DRIVE,
    sources: result.streamUrls.map((stream) => ({
      src: stream.src,
      ...(stream.resolution === undefined ? {} : { resolution: stream.resolution }),
      ...(stream.mimeType === undefined ? {} : { mimeType: stream.mimeType }),
    })),
    ...(result.expiresAt === undefined ? {} : { expiresAt: result.expiresAt.toISOString() }),
    fallback: iframeFallback(result.playerUrl),
    aspectRatio: 16 / 9,
  };
}

function toIframeDescriptor(playerUrl: string): Extract<PlaybackDescriptor, { type: 'iframe' }> {
  return {
    type: 'iframe',
    provider: MediaProviderId.GOOGLE_DRIVE,
    url: playerUrl,
    allow: GOOGLE_DRIVE_PREVIEW_ALLOW,
    requiresSameOrigin: true,
    aspectRatio: 16 / 9,
  };
}

/**
 * Google Drive provider.
 *
 * Parses stable share-link identity, resolves temporary playback variants from
 * the same surfaces Drive's web player uses, caches them briefly, and always
 * keeps the documented `/preview` iframe as a fallback.
 */
export function createGoogleDriveProvider(
  options: GoogleDriveProviderOptions = {},
): ExternalMediaProvider {
  const resolver = new GoogleDriveResolver(options);
  const cache = options.cache;
  const throwOnHardFailure = options.throwOnHardFailure ?? false;

  return {
    definition: googleDriveDefinition,

    supports(url: URL): boolean {
      return isGoogleDrivePageHost(url.hostname);
    },

    parse(url: URL): ParsedExternalMedia | null {
      const source = parseGoogleDriveUrl(url);
      if (source === null) return null;

      return {
        provider: MediaProviderId.GOOGLE_DRIVE,
        externalId: source.fileId,
        ...(source.resourceKey === undefined ? {} : { resourceKey: source.resourceKey }),
        canonicalUrl: toCanonicalGoogleDriveUrl(source),
        displayHost: 'drive.google.com',
      };
    },

    async resolvePlayback(
      source: ExternalMediaSource,
      _context: PlaybackContext,
    ): Promise<PlaybackDescriptor> {
      const identity = assertValidGoogleDriveIdentity(source.externalId, source.resourceKey);
      if (identity === null) {
        return {
          type: 'unavailable',
          provider: MediaProviderId.GOOGLE_DRIVE,
          reason: 'provider_not_supported',
        };
      }

      const playerUrl = buildGoogleDrivePreviewUrl(identity.fileId, identity.resourceKey);

      if (cache !== undefined) {
        const cached = await cache.get(
          MediaProviderId.GOOGLE_DRIVE,
          identity.fileId,
          identity.resourceKey ?? null,
        );
        if (cached !== null) return cached;
      }

      let outcome;
      try {
        outcome = await resolver.resolve(identity.fileId, identity.resourceKey);
      } catch (error) {
        if (throwOnHardFailure) {
          throw new ExternalMediaResolutionError(undefined, { cause: error });
        }
        return toIframeDescriptor(playerUrl);
      }

      if (outcome.status === 'access_denied') {
        if (throwOnHardFailure) {
          throw new ExternalMediaAccessDeniedError();
        }
        return {
          type: 'unavailable',
          provider: MediaProviderId.GOOGLE_DRIVE,
          reason: 'requires_provider_permission',
          fallbackUrl: playerUrl,
        };
      }

      if (outcome.status === 'not_found') {
        if (throwOnHardFailure) {
          throw new ExternalMediaUnavailableError();
        }
        return {
          type: 'unavailable',
          provider: MediaProviderId.GOOGLE_DRIVE,
          reason: 'upstream_unavailable',
          fallbackUrl: playerUrl,
        };
      }

      if (outcome.playback.streamUrls.length > 0) {
        const descriptor = toNativeDescriptor(outcome.playback);
        if (cache !== undefined) {
          await cache.set(
            MediaProviderId.GOOGLE_DRIVE,
            identity.fileId,
            identity.resourceKey ?? null,
            descriptor,
            outcome.playback.expiresAt,
          );
        }
        return descriptor;
      }

      // Accessible file with no extractable variants: documented preview iframe.
      const iframe = toIframeDescriptor(playerUrl);
      if (cache !== undefined) {
        await cache.set(
          MediaProviderId.GOOGLE_DRIVE,
          identity.fileId,
          identity.resourceKey ?? null,
          iframe,
        );
      }
      return iframe;
    },
  };
}

/** Default instance used by the platform registry. Cache is attached by the API. */
export const googleDriveProvider = createGoogleDriveProvider();
