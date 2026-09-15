import { ProviderEmbedPolicy, type PlaybackDescriptor, type PlaybackSource } from '@playanime/contracts';
import { ExternalMediaAccessDeniedError } from '../../errors.js';
import type {
  ExternalMediaProvider,
  ExternalMediaSource,
  ParsedExternalMedia,
  PlaybackContext,
  ProviderDefinition,
} from '../../types/index.js';
import { CdaError } from './CdaErrors.js';
import { cdaPageUrl, extractCdaVideoId, normalizeCdaUrl } from './CdaParser.js';
import { CdaResolver } from './CdaResolver.js';
import type { CdaProviderOptions, CdaStream } from './CdaTypes.js';

/**
 * CDA.pl.
 *
 * The public page supplies player_data, including the available qualities and
 * the opaque token its own videoGetLink requests use. We reuse those values
 * unchanged and expose only URLs CDA returns to this anonymous session.
 *
 * Native/HLS capability does not grant permission to frame arbitrary CDA pages.
 * No iframe URL is constructed here; unsupported playback keeps an off-site link.
 */
export const cdaDefinition: ProviderDefinition = {
  id: 'cda',
  label: 'CDA',
  hosts: ['cda.pl', 'ebd.cda.pl'],
  // Native playback is independent of permission to construct an iframe.
  embedPolicy: ProviderEmbedPolicy.LINK_ONLY,
  canEmitNative: true,
  supportsAvailabilityCheck: false,
  reliabilityWeight: 70,
  // CDA chooses CDN hosts dynamically. Only safe URLs from its HTTPS player
  // responses enter descriptors; stored metadata never supplies media URLs.
  isMediaUrlAllowed: (url) => normalizeCdaUrl(url) === url,
};

function playbackSource(source: CdaStream): PlaybackSource {
  return {
    src: source.url,
    mimeType: source.type === 'hls' ? 'application/vnd.apple.mpegurl' : 'video/mp4',
    ...(source.resolution === undefined ? {} : { resolution: source.resolution }),
  };
}

/**
 * Adapt CDA's provider-specific result to the shared playback contract.
 *
 * Only the descriptor is cached, for at most one minute. The source's durable
 * identity remains its video ID and canonical page URL. The existing API's
 * refresh=1 path invalidates this cache before fetching new player tokens.
 */
export function createCdaProvider(options: CdaProviderOptions = {}): ExternalMediaProvider {
  const resolver = new CdaResolver(options);
  return {
    definition: cdaDefinition,
    supports(url: URL): boolean {
      return extractCdaVideoId(url) !== null;
    },

    parse(url: URL): ParsedExternalMedia | null {
      const id = extractCdaVideoId(url);
      if (id === null) return null;

      return {
        provider: 'cda',
        externalId: id,
        canonicalUrl: cdaPageUrl(id),
        displayHost: 'cda.pl',
      };
    },

    async resolvePlayback(
      source: ExternalMediaSource,
      _context: PlaybackContext,
    ): Promise<PlaybackDescriptor> {
      try {
        const page = cdaPageUrl(source.externalId);
        const cached = await options.cache?.get('cda', source.externalId, source.resourceKey);
        if (cached != null) return cached;

        const result = await resolver.resolve(source.externalId);
        const hls = result.sources.filter((stream) => stream.type === 'hls');
        const mp4 = result.sources.filter((stream) => stream.type === 'mp4');
        let descriptor: PlaybackDescriptor;
        const first = hls[0];

        // Each HLS quality may be a separate playlist. Do not claim these are
        // levels within one master; the adapter switches their actual URLs.
        if (first !== undefined) {
          descriptor = {
            type: 'hls',
            provider: 'cda',
            src: first.url,
            sources: hls.map(playbackSource),
            expiresAt: result.expiresAt.toISOString(),
          };
        } else if (mp4.length > 0) {
          descriptor = {
            type: 'native',
            provider: 'cda',
            sources: mp4.map(playbackSource),
            expiresAt: result.expiresAt.toISOString(),
          };
        } else {
          // DASH has no adapter in PlayAnime. The provider's page remains usable.
          return { type: 'external', provider: 'cda', url: page, displayHost: 'cda.pl' };
        }

        await options.cache?.set(
          'cda',
          source.externalId,
          source.resourceKey,
          descriptor,
          result.expiresAt,
          60,
        );
        return descriptor;
      } catch (error) {
        // Log only a bounded reason code, never upstream bodies or signed URLs.
        options.logger?.warn('CDA playback resolution failed', {
          provider: 'cda',
          'data.reason': error instanceof CdaError ? error.reason : 'CDA_VIDEO_UNAVAILABLE',
        });
        if (options.throwOnHardFailure === true) throw error;
        const id = extractCdaVideoId(source.externalId);
        return {
          type: 'unavailable',
          provider: 'cda',
          reason:
            error instanceof ExternalMediaAccessDeniedError
              ? 'requires_provider_permission'
              : error instanceof CdaError
                ? error.reason
                : 'upstream_unavailable',
          ...(id === null ? {} : { fallbackUrl: cdaPageUrl(id) }),
        };
      }
    },
  };
}

/** Default instance; the API registry creates its own instance with Redis caching. */
export const cdaProvider = createCdaProvider();
