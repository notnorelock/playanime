import { hostMatches } from '../../validation/url.js';

/**
 * Rumble host policy and URL construction.
 *
 * This is the provider's SSRF boundary. Every URL the resolver is allowed to
 * fetch, and every media URL allowed into a descriptor, is checked here
 * against a parsed hostname — never against a substring of the URL, which is
 * what makes `rumble.com.attacker.net` and `attacker.com/?u=rumble.com` fail.
 */

/** Hosts that may appear on a submitted page or embed URL. */
export const RUMBLE_PAGE_HOSTS = ['rumble.com'] as const;

/**
 * Hosts permitted on resolved media URLs.
 *
 * `rumble.cloud` is Rumble's CDN, where HLS renditions and progressive files
 * are served (e.g. `hugh.cdn.rumble.cloud`). Master playlists themselves are
 * served from `rumble.com/hls-vod/...`, so both are required.
 */
export const RUMBLE_MEDIA_HOSTS = ['rumble.com', 'rumble.cloud'] as const;

/**
 * Embed ids are short base36-ish tokens prefixed with `v`.
 *
 * A publisher-scoped embed id may carry a numeric prefix — `/embed/4.v3abcd/`
 * — which is validated separately so the prefix cannot smuggle path segments.
 */
const EMBED_ID = /^v[0-9a-z]{3,16}$/i;
const PUBLISHER_PREFIX = /^[0-9a-z]{1,12}$/i;

export const RUMBLE_EMBED_ALLOW =
  'autoplay; encrypted-media; fullscreen; picture-in-picture';

export function isRumblePageHost(hostname: string): boolean {
  return hostMatches(hostname, RUMBLE_PAGE_HOSTS);
}

export function isRumbleMediaHost(hostname: string): boolean {
  return hostMatches(hostname, RUMBLE_MEDIA_HOSTS);
}

export function isRumbleEmbedId(value: string): boolean {
  return EMBED_ID.test(value);
}

/**
 * Splits a possibly publisher-prefixed embed token.
 *
 * Rumble serves `/embed/{id}/` and `/embed/{publisher}.{id}/`. Both address the
 * same video, so only the id survives normalization.
 */
export function parseEmbedToken(token: string): string | null {
  if (isRumbleEmbedId(token)) return token;

  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;

  const prefix = token.slice(0, dot);
  const id = token.slice(dot + 1);

  if (!PUBLISHER_PREFIX.test(prefix)) return null;
  if (!isRumbleEmbedId(id)) return null;

  return id;
}

/**
 * The canonical embed player URL.
 *
 * Built from a validated id, never by string-concatenating user input, so a
 * parsing bug cannot point the iframe at another origin.
 */
export function buildRumbleEmbedUrl(embedId: string): string {
  if (!isRumbleEmbedId(embedId)) {
    throw new Error('Refusing to build a Rumble embed URL from an invalid id.');
  }
  return `https://rumble.com/embed/${embedId}/`;
}

/** Rumble's documented oEmbed endpoint, used to resolve page → embed id. */
export function buildRumbleOEmbedUrl(pageUrl: string): string {
  const url = new URL('https://rumble.com/api/Media/oembed.json');
  url.searchParams.set('url', pageUrl);
  return url.toString();
}

/**
 * The embed player's own metadata request.
 *
 * Provider-internal: this shape is Rumble's and may change, which is why it
 * lives behind the resolver and always has the iframe as a fallback.
 */
export function buildRumblePlaybackMetadataUrl(embedId: string): string {
  if (!isRumbleEmbedId(embedId)) {
    throw new Error('Refusing to build a Rumble metadata URL from an invalid id.');
  }
  const url = new URL('https://rumble.com/embedJS/u3/');
  url.searchParams.set('request', 'video');
  url.searchParams.set('ver', '2');
  url.searchParams.set('v', embedId);
  return url.toString();
}

/**
 * Guard for a URL the resolver is about to fetch, applied again after
 * redirects.
 *
 * Returns false for anything that is not https-on-a-Rumble-host, which keeps
 * a redirect from walking the request onto an internal address.
 */
export function isFetchableRumbleUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'https:') return false;
  if (parsed.username !== '' || parsed.password !== '') return false;

  return isRumblePageHost(parsed.hostname);
}

/** Whether a resolved media URL may be handed to the player. */
export function isAllowedRumbleMediaUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'https:') return false;
  if (parsed.username !== '' || parsed.password !== '') return false;

  return isRumbleMediaHost(parsed.hostname);
}

/** Origin + path only: Rumble CDN query strings carry signed byte ranges. */
export function describeRumbleMediaUrl(value: string): string {
  try {
    const parsed = new URL(value);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return '[invalid-url]';
  }
}
