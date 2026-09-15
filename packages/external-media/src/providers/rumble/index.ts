import { MediaProviderId, ProviderEmbedPolicy, type PlaybackDescriptor } from '@playanime/contracts';
import type {
  ExternalMediaProvider,
  ExternalMediaSource,
  ParsedExternalMedia,
  PlaybackContext,
  ProviderDefinition,
} from '../../types/index.js';
import { hostMatches } from '../../validation/url.js';

/**
 * Rumble.
 *
 * Rumble publishes an embed player at `rumble.com/embed/{embedId}/` and an
 * oEmbed endpoint that returns the corresponding iframe markup. Both are
 * intended for third-party embedding, which is what makes this an `EMBED`
 * provider rather than a link-only one.
 *
 * ## Two different identifiers
 *
 * A Rumble page URL carries a *page slug* (`/v3abcd-some-title.html`), while
 * the embed player takes a distinct *embed id* (`v3abcd`). The leading `v` plus
 * the alphanumeric prefix of the slug is the embed id; the trailing
 * human-readable title is decorative and is dropped during normalization.
 *
 * A URL that is already an `/embed/{id}/` link gives the embed id directly.
 *
 * ## Uploader control is respected
 *
 * Rumble lets an uploader disable embedding per video. When that is set, the
 * embed renders Rumble's own notice and the viewer can follow the canonical
 * link instead. That is the uploader's decision and nothing here works around
 * it.
 */

/** Rumble ids are short base36-ish tokens, always prefixed with `v`. */
const EMBED_ID = /^v[0-9a-z]{4,12}$/i;

export const rumbleDefinition: ProviderDefinition = {
  id: MediaProviderId.RUMBLE,
  label: 'Rumble',
  hosts: ['rumble.com'],
  embedPolicy: ProviderEmbedPolicy.EMBED,
  canEmitNative: false,
  // Rumble's oEmbed endpoint is a documented metadata surface and is a valid
  // liveness probe. It returns metadata only and never touches media bytes.
  supportsAvailabilityCheck: true,
  reliabilityWeight: 55,
};

/** Extracts the embed id from a page URL or an existing embed URL. */
function extractEmbedId(url: URL): string | null {
  const segments = url.pathname.split('/').filter(Boolean);

  // /embed/{embedId}/ — already an embed link.
  const embedIndex = segments.indexOf('embed');
  if (embedIndex >= 0) {
    const candidate = segments[embedIndex + 1];
    if (candidate !== undefined && EMBED_ID.test(candidate)) return candidate;
  }

  // /{slug}.html or /{slug} — the embed id is the leading token of the slug,
  // up to the first hyphen.
  const [first] = segments;
  if (first === undefined) return null;

  const slug = first.replace(/\.html$/, '');
  const [token] = slug.split('-');
  if (token !== undefined && EMBED_ID.test(token)) return token;

  return null;
}

export const rumbleProvider: ExternalMediaProvider = {
  definition: rumbleDefinition,

  supports(url: URL): boolean {
    return hostMatches(url.hostname, rumbleDefinition.hosts);
  },

  parse(url: URL): ParsedExternalMedia | null {
    const embedId = extractEmbedId(url);
    if (embedId === null) return null;

    return {
      provider: MediaProviderId.RUMBLE,
      externalId: embedId,
      // Canonicalize to the embed form: it is stable, whereas the page slug
      // changes whenever the uploader edits the title.
      canonicalUrl: `https://rumble.com/embed/${embedId}/`,
      displayHost: 'rumble.com',
    };
  },

  resolvePlayback(source: ExternalMediaSource, context: PlaybackContext): PlaybackDescriptor {
    if (!EMBED_ID.test(source.externalId)) {
      return {
        type: 'unavailable',
        provider: MediaProviderId.RUMBLE,
        reason: 'provider_not_supported',
      };
    }

    const embed = new URL(`https://rumble.com/embed/${source.externalId}/`);
    if (context.autoplay) embed.searchParams.set('autoplay', '2');

    return {
      type: 'iframe',
      provider: MediaProviderId.RUMBLE,
      url: embed.toString(),
      allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen',
      // Rumble's player stores playback state against its own origin.
      requiresSameOrigin: true,
      aspectRatio: 16 / 9,
    };
  },
};
