import { MediaProviderId, ProviderEmbedPolicy, type PlaybackDescriptor } from '@playanime/contracts';
import type {
  ExternalMediaProvider,
  ExternalMediaSource,
  ParsedExternalMedia,
  PlaybackContext,
  ProviderDefinition,
} from '../../types/index.js';
import { hostMatches, normalizeHost } from '../../validation/url.js';

/**
 * YouTube.
 *
 * Integration uses the publicly documented IFrame Player API embed URL:
 * https://developers.google.com/youtube/iframe_api_reference
 *
 * `youtube-nocookie.com` is YouTube's own privacy-enhanced embed domain, also
 * documented, and is preferred so a viewer browsing PlayAnime is not given
 * tracking cookies by a third party before they choose to play anything.
 *
 * Age-restricted and embedding-disabled videos are the uploader's decision. The
 * embed simply fails and the player falls back to the off-site link — that is
 * the correct behaviour, and no attempt is made to work around it.
 */

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export const youtubeDefinition: ProviderDefinition = {
  id: MediaProviderId.YOUTUBE,
  label: 'YouTube',
  hosts: ['youtube.com', 'youtu.be', 'youtube-nocookie.com', 'm.youtube.com'],
  embedPolicy: ProviderEmbedPolicy.EMBED,
  canEmitNative: false,
  // The Data API requires a key and quota; the worker uses the oEmbed endpoint,
  // which is documented and intended for exactly this kind of lookup.
  supportsAvailabilityCheck: true,
  reliabilityWeight: 90,
};

/** Reads a start offset from `t`/`start`, accepting `90`, `1m30s`, `2h3m4s`. */
function parseStart(url: URL): number | undefined {
  const raw = url.searchParams.get('t') ?? url.searchParams.get('start');
  if (raw === null) return undefined;

  if (/^\d+$/.test(raw)) return Number.parseInt(raw, 10);

  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(raw);
  if (!match || match[0] === '') return undefined;

  const [, h, m, s] = match;
  const total =
    Number.parseInt(h ?? '0', 10) * 3600 +
    Number.parseInt(m ?? '0', 10) * 60 +
    Number.parseInt(s ?? '0', 10);

  return total > 0 ? total : undefined;
}

/** Extracts the video id from every documented YouTube URL shape. */
function extractVideoId(url: URL): string | null {
  const host = normalizeHost(url.hostname);
  const segments = url.pathname.split('/').filter(Boolean);

  // youtu.be/VIDEOID
  if (host === 'youtu.be') {
    const [id] = segments;
    return id !== undefined && VIDEO_ID.test(id) ? id : null;
  }

  // youtube.com/watch?v=VIDEOID
  const queryId = url.searchParams.get('v');
  if (queryId !== null && VIDEO_ID.test(queryId)) return queryId;

  // youtube.com/{embed,v,shorts,live}/VIDEOID
  const [prefix, candidate] = segments;
  if (
    candidate !== undefined &&
    prefix !== undefined &&
    ['embed', 'v', 'shorts', 'live'].includes(prefix) &&
    VIDEO_ID.test(candidate)
  ) {
    return candidate;
  }

  return null;
}

export const youtubeProvider: ExternalMediaProvider = {
  definition: youtubeDefinition,

  supports(url: URL): boolean {
    return hostMatches(url.hostname, youtubeDefinition.hosts);
  },

  parse(url: URL): ParsedExternalMedia | null {
    const videoId = extractVideoId(url);
    if (videoId === null) return null;

    const startSeconds = parseStart(url);

    return {
      provider: MediaProviderId.YOUTUBE,
      externalId: videoId,
      // Canonical form drops playlist, tracking and referral parameters.
      canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
      displayHost: 'youtube.com',
      ...(startSeconds === undefined ? {} : { startSeconds }),
    };
  },

  resolvePlayback(source: ExternalMediaSource, context: PlaybackContext): PlaybackDescriptor {
    if (!VIDEO_ID.test(source.externalId)) {
      return {
        type: 'unavailable',
        provider: MediaProviderId.YOUTUBE,
        reason: 'provider_not_supported',
      };
    }

    const embed = new URL(`https://www.youtube-nocookie.com/embed/${source.externalId}`);

    // Documented IFrame Player API parameters only.
    embed.searchParams.set('rel', '0');
    embed.searchParams.set('modestbranding', '1');
    embed.searchParams.set('playsinline', '1');
    embed.searchParams.set('hl', context.locale);
    // Required by the API when the host page controls playback.
    embed.searchParams.set('enablejsapi', '1');
    embed.searchParams.set('origin', context.embedOrigin);

    if (context.autoplay) embed.searchParams.set('autoplay', '1');

    const start = context.startSeconds ?? 0;
    if (start > 0) embed.searchParams.set('start', String(Math.floor(start)));

    return {
      type: 'iframe',
      provider: MediaProviderId.YOUTUBE,
      url: embed.toString(),
      allow: 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen',
      // The IFrame API posts messages from the youtube-nocookie origin and needs
      // its own storage for playback state.
      requiresSameOrigin: true,
      aspectRatio: 16 / 9,
    };
  },
};
