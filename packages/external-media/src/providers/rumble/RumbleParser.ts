import type {
  RumbleLiveState,
  RumblePlaybackSource,
  RumbleSource,
  RumbleStreamType,
  RumbleSubtitle,
} from './RumbleTypes.js';
import {
  buildRumbleEmbedUrl,
  isRumbleEmbedId,
  isRumblePageHost,
  parseEmbedToken,
} from './RumbleUrls.js';

/**
 * Rumble parsing, kept separate from network access and from descriptor
 * construction.
 *
 * Each function below handles exactly one input shape. Together they replace
 * what would otherwise be a single regex run over a whole HTML page — the thing
 * that silently starts matching the wrong text the next time Rumble ships a
 * template change.
 */

/* -------------------------------------------------------------------------- */
/* URL parsing                                                                */
/* -------------------------------------------------------------------------- */

/** Page paths that are never a single video. */
const NON_VIDEO_SEGMENTS = new Set([
  'c',
  'user',
  'channel',
  'search',
  'browse',
  'category',
  'account',
  'license',
  'premium',
  'subscriptions',
  'api',
  'live',
  'editor',
  'upload',
  's',
]);

export interface RumbleUrlIdentity {
  /** Present only when the URL was already an embed URL. */
  readonly embedId?: string;
  /** Leading slug token from a public page URL, e.g. `v7fj6io`. */
  readonly pageSlugId?: string;
  /** Page URL suitable for an oEmbed lookup, query and fragment stripped. */
  readonly pageUrl?: string;
}

/**
 * Extracts whatever identity a Rumble URL carries.
 *
 * Deliberately does not conflate the two ids: an embed URL yields `embedId`,
 * a page URL yields `pageSlugId` plus a cleaned `pageUrl`. Resolving the slug
 * to a real embed id requires a network lookup and belongs to the resolver.
 */
export function parseRumbleUrl(url: URL): RumbleUrlIdentity | null {
  if (!isRumblePageHost(url.hostname)) return null;

  const segments = url.pathname.split('/').filter((segment) => segment !== '');

  // /embed/{id}/ or /embed/{publisher}.{id}/
  const embedIndex = segments.indexOf('embed');
  if (embedIndex >= 0) {
    const token = segments[embedIndex + 1];
    if (token === undefined) return null;
    const embedId = parseEmbedToken(token);
    return embedId === null ? null : { embedId };
  }

  const [first] = segments;
  if (first === undefined) return null;

  // A video page is always a single top-level slug. Anything nested, or under a
  // known section prefix, is a channel/search/category page instead.
  if (NON_VIDEO_SEGMENTS.has(first.toLowerCase())) return null;
  if (segments.length > 1) return null;

  const slug = first.replace(/\.html$/i, '');
  const [token] = slug.split('-');
  if (token === undefined || !isRumbleEmbedId(token)) return null;

  // Query and fragment are dropped: Rumble page links carry referral and
  // session parameters (`?e9s=...`) that would defeat deduplication.
  return {
    pageSlugId: token,
    pageUrl: `https://rumble.com/${slug}.html`,
  };
}

/** Builds the stored identity once a real embed id is known. */
export function toRumbleSource(
  embedId: string,
  pageSlugId?: string,
): RumbleSource {
  return {
    provider: 'rumble',
    embedId,
    ...(pageSlugId === undefined ? {} : { pageSlugId }),
    canonicalUrl: buildRumbleEmbedUrl(embedId),
  };
}

/* -------------------------------------------------------------------------- */
/* oEmbed                                                                     */
/* -------------------------------------------------------------------------- */

export interface RumbleOEmbedMetadata {
  readonly embedId: string;
  readonly title?: string;
  readonly channel?: string;
  readonly thumbnail?: string;
  readonly durationSeconds?: number;
  readonly width?: number;
  readonly height?: number;
}

/** Matches only an embed URL inside oEmbed's iframe markup. */
const EMBED_SRC = /https:\/\/rumble\.com\/embed\/([A-Za-z0-9.]+)\/?/;

/**
 * Reads the embed id out of an oEmbed response.
 *
 * This is the authoritative page → embed id mapping: Rumble returns the iframe
 * markup its own embed button produces. The alternative — assuming the page
 * slug is the embed id — is wrong for most videos.
 */
export function parseRumbleOEmbed(body: unknown): RumbleOEmbedMetadata | null {
  if (!isRecord(body)) return null;

  const html = body['html'];
  if (typeof html !== 'string') return null;

  const match = EMBED_SRC.exec(html);
  if (match === null) return null;

  const token = match[1];
  if (token === undefined) return null;

  const embedId = parseEmbedToken(token);
  if (embedId === null) return null;

  const duration = asPositiveNumber(body['duration']);
  const title = asNonEmptyString(body['title']);
  const channel = asNonEmptyString(body['author_name']);
  const thumbnail = asNonEmptyString(body['thumbnail_url']);
  const width = asPositiveNumber(body['width']);
  const height = asPositiveNumber(body['height']);

  return {
    embedId,
    ...(title === undefined ? {} : { title }),
    ...(channel === undefined ? {} : { channel }),
    ...(thumbnail === undefined ? {} : { thumbnail }),
    ...(duration === undefined ? {} : { durationSeconds: duration }),
    ...(width === undefined ? {} : { width }),
    ...(height === undefined ? {} : { height }),
  };
}

/* -------------------------------------------------------------------------- */
/* Playback metadata                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Container keys in the player response that are actually playable video.
 *
 * This allowlist is the single most important line in the file. The response's
 * format map also contains:
 *
 * - `tar`   — `.tar` archives of HLS segments, addressed by byte range. Not
 *             playable by `<video>`; they exist for the player's own loader.
 * - `timeline` — a ~180p sprite track for scrub previews. It looks exactly like
 *             a quality entry and is not one.
 * - `audio` — an audio-only `.aac` rendition.
 *
 * Emitting any of those as a "quality" would put a broken or absurd option in
 * the viewer's menu, so unknown keys are ignored rather than passed through.
 */
const PLAYABLE_FORMATS: Readonly<Record<string, RumbleStreamType>> = {
  mp4: 'mp4',
  webm: 'webm',
  hls: 'hls',
};

/**
 * Format keys that describe the HLS ladder without being playable themselves.
 *
 * `tar` entries are segment archives addressed by byte range — unplayable by
 * `<video>` — but their `meta` mirrors the master playlist exactly. Verified
 * against a real video: `tar` reported 1080/720/480/360 at 1235/922/577/426
 * kbps, matching the playlist's `RESOLUTION`/`BANDWIDTH` lines one for one.
 *
 * So they are read for *labels only*, which is how an adaptive stream gets a
 * quality menu without inventing entries. `timeline` (a scrub-thumbnail track)
 * and `audio` are excluded: neither is a video rendition.
 */
const LADDER_DESCRIPTOR_FORMATS = new Set(['tar']);

const MIME_TYPES: Readonly<Record<RumbleStreamType, string>> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  hls: 'application/vnd.apple.mpegurl',
};

/** One rung of the adaptive ladder. Describes a rendition; is not a source. */
export interface RumbleLadderRung {
  readonly resolution: number;
  /** Kbps, as Rumble reports it. */
  readonly bitrate?: number;
}

export interface RumblePlaybackMetadata {
  readonly sources: readonly RumblePlaybackSource[];
  /**
   * Renditions advertised for the adaptive stream, highest first.
   *
   * Labels only — never playback URLs. Used to populate the quality menu for an
   * HLS descriptor, where the playable source is a single master playlist.
   */
  readonly ladder: readonly RumbleLadderRung[];
  readonly subtitles: readonly RumbleSubtitle[];
  readonly liveState: RumbleLiveState;
  readonly durationSeconds?: number;
  readonly title?: string;
  readonly thumbnail?: string;
  readonly channel?: string;
}

/**
 * Normalizes the embed player's metadata response.
 *
 * Returns `null` when the payload is not a usable object at all — notably when
 * Rumble answers a removed or non-embeddable video with the literal `false`
 * under an HTTP 200, which a status-code check alone would read as success.
 */
export function parseRumblePlaybackMetadata(body: unknown): RumblePlaybackMetadata | null {
  if (!isRecord(body)) return null;

  const sources = [
    ...collectFormatSources(body['ua']),
    // `u` is the legacy single-rendition map. Used only to fill gaps, since it
    // repeats what `ua` already carries for current videos.
    ...collectFormatSources(body['u']),
  ];

  const liveState = parseLiveState(body);
  const duration = asPositiveNumber(body['duration']);
  const title = asNonEmptyString(body['title']);
  const thumbnail = asNonEmptyString(body['i']);
  const channel = parseChannel(body['author']);

  return {
    sources: dedupeSources(sources),
    ladder: collectLadder(body['ua']),
    subtitles: parseSubtitles(body['cc']),
    liveState,
    // A live edge stream has no fixed duration, and Rumble reports `0` for
    // some VODs — neither should become a bogus `0s` runtime.
    ...(liveState === 'live' || duration === undefined ? {} : { durationSeconds: duration }),
    ...(title === undefined ? {} : { title }),
    ...(thumbnail === undefined ? {} : { thumbnail }),
    ...(channel === undefined ? {} : { channel }),
  };
}

/**
 * Walks a `{ format: { quality: { url, meta } } }` map.
 *
 * Tolerates the quality key being `"auto"` (HLS) or a height (`"720"`), and
 * prefers `meta.h` over the key because the key is a label while `meta` is
 * measured. A rendition whose URL is not on a Rumble host is dropped here
 * rather than trusted because it appeared in a Rumble response.
 */
function collectFormatSources(raw: unknown): RumblePlaybackSource[] {
  if (!isRecord(raw)) return [];

  const collected: RumblePlaybackSource[] = [];

  for (const [formatKey, renditions] of Object.entries(raw)) {
    const type = PLAYABLE_FORMATS[formatKey.toLowerCase()];
    if (type === undefined) continue;

    // An empty array is how Rumble says "this format has no renditions".
    if (!isRecord(renditions)) continue;

    for (const [qualityKey, rendition] of Object.entries(renditions)) {
      if (!isRecord(rendition)) continue;

      const url = asNonEmptyString(rendition['url']);
      if (url === undefined) continue;

      const meta = isRecord(rendition['meta']) ? rendition['meta'] : {};
      const width = asPositiveNumber(meta['w']);
      const height = asPositiveNumber(meta['h']);
      const bitrate = asPositiveNumber(meta['bitrate']);
      const resolution = height ?? asPositiveNumber(qualityKey);

      collected.push({
        url,
        type,
        ...(resolution === undefined ? {} : { resolution }),
        ...(width === undefined ? {} : { width }),
        ...(height === undefined ? {} : { height }),
        ...(bitrate === undefined ? {} : { bitrate }),
        mimeType: MIME_TYPES[type],
      });
    }
  }

  return collected;
}

/**
 * Reads resolution labels from the ladder-describing formats.
 *
 * Takes only `meta` dimensions and bitrate — never the URL, so a `.tar` archive
 * cannot leak into a descriptor from here. A rung without a usable height is
 * skipped rather than labelled from its key alone.
 */
function collectLadder(raw: unknown): RumbleLadderRung[] {
  if (!isRecord(raw)) return [];

  const byResolution = new Map<number, RumbleLadderRung>();

  for (const [formatKey, renditions] of Object.entries(raw)) {
    if (!LADDER_DESCRIPTOR_FORMATS.has(formatKey.toLowerCase())) continue;
    if (!isRecord(renditions)) continue;

    for (const [qualityKey, rendition] of Object.entries(renditions)) {
      if (!isRecord(rendition)) continue;

      const meta = isRecord(rendition['meta']) ? rendition['meta'] : {};
      const resolution = asPositiveNumber(meta['h']) ?? asPositiveNumber(qualityKey);
      if (resolution === undefined) continue;

      const rounded = Math.round(resolution);
      if (byResolution.has(rounded)) continue;

      const bitrate = asPositiveNumber(meta['bitrate']);
      byResolution.set(rounded, {
        resolution: rounded,
        ...(bitrate === undefined ? {} : { bitrate }),
      });
    }
  }

  return [...byResolution.values()].sort((a, b) => b.resolution - a.resolution);
}

/** First occurrence of a URL wins, so `ua` takes precedence over `u`. */
function dedupeSources(sources: readonly RumblePlaybackSource[]): RumblePlaybackSource[] {
  const seen = new Set<string>();
  const unique: RumblePlaybackSource[] = [];

  for (const source of sources) {
    if (seen.has(source.url)) continue;
    seen.add(source.url);
    unique.push(source);
  }

  return unique;
}

/**
 * Derives live state from `live` plus `duration`.
 *
 * Rumble's `live` is an enum whose values are not documented for third
 * parties. What is observable: `0` is an ordinary VOD, and `2` appears both on
 * a stream that is currently live and on its finished DVR recording — those are
 * distinguished by whether a duration exists.
 */
function parseLiveState(body: Record<string, unknown>): RumbleLiveState {
  const live = body['live'];
  if (typeof live !== 'number' || live === 0) return 'vod';

  if (live === 1) return 'upcoming';

  const duration = asPositiveNumber(body['duration']);
  if (duration !== undefined) return 'recorded_live';

  return 'live';
}

/**
 * Normalizes caption tracks.
 *
 * Rumble sends `[]` when there are none, and a `{ lang: {...} }` map when there
 * are. Both shapes must survive, since an unexpected one previously meant
 * `Object.entries` over an array index.
 */
function parseSubtitles(raw: unknown): RumbleSubtitle[] {
  if (!isRecord(raw)) return [];

  const subtitles: RumbleSubtitle[] = [];

  for (const [language, track] of Object.entries(raw)) {
    if (!isRecord(track)) continue;

    const url = asNonEmptyString(track['path']) ?? asNonEmptyString(track['url']);
    if (url === undefined) continue;

    const label = asNonEmptyString(track['language']) ?? language;

    subtitles.push({ language, label, url });
  }

  return subtitles;
}

function parseChannel(raw: unknown): string | undefined {
  if (!isRecord(raw)) return undefined;
  return asNonEmptyString(raw['name']);
}

/* -------------------------------------------------------------------------- */
/* Primitives                                                                 */
/* -------------------------------------------------------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/** Accepts a positive number, or a numeric string such as a `"720"` key. */
function asPositiveNumber(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? value : undefined;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  }
  return undefined;
}
