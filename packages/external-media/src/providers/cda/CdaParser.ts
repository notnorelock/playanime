import { parse, type DefaultTreeAdapterMap } from 'parse5';
import { isIP } from 'node:net';
import { tryParseSubmittedUrl } from '../../validation/url.js';
import { CdaError } from './CdaErrors.js';
import type { CdaPlayerData, CdaStream } from './CdaTypes.js';

/** Opaque CDA identity; kept compatible with previously stored CDA links. */
const VIDEO_ID = /^[A-Za-z0-9_-]{4,40}$/;

/**
 * Recognize video pages and the embed form already supported by PlayAnime.
 * Raw IDs are accepted only by internal callers; URL submission still goes
 * through the registry's normal URL validation.
 */
export function extractCdaVideoId(input: string | URL): string | null {
  if (typeof input === 'string' && VIDEO_ID.test(input)) return input;
  const url = typeof input === 'string' ? tryParseSubmittedUrl(input) : input;
  if (
    url === null ||
    !['http:', 'https:'].includes(url.protocol) ||
    url.username !== '' ||
    url.password !== '' ||
    url.port !== ''
  ) {
    return null;
  }
  if (url.hostname === 'ebd.cda.pl') {
    return /^\/\d+x\d+\/([A-Za-z0-9_-]{4,40})\/?$/.exec(url.pathname)?.[1] ?? null;
  }
  if (url.hostname !== 'cda.pl' && url.hostname !== 'www.cda.pl') return null;
  return /^\/video\/([A-Za-z0-9_-]{4,40})\/?$/.exec(url.pathname)?.[1] ?? null;
}

/** Construct the sole page endpoint from validated identity, never stored metadata. */
export function cdaPageUrl(id: string): string {
  if (!VIDEO_ID.test(id)) throw new CdaError('CDA_INVALID_URL');
  return `https://www.cda.pl/video/${id}`;
}

/**
 * CDN URLs come from CDA's HTTPS response, never from stored source metadata.
 * No media bytes are fetched by the server. Reject local/IP/credential targets.
 */
export function normalizeCdaUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const url = tryParseSubmittedUrl(value.startsWith('//') ? `https:${value}` : value);
  if (
    url?.protocol !== 'https:' ||
    url.port !== '' ||
    isIP(url.hostname) !== 0 ||
    url.hostname.includes(':') ||
    /\.(?:localhost|home|lan)$/i.test(url.hostname) ||
    !/\.[a-z]{2,}$/i.test(url.hostname)
  ) {
    return undefined;
  }
  return url.toString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Collect real player_data attributes from the HTML tree.
 *
 * parse5 decodes named and numeric HTML entities exactly once. Script text,
 * comments, and attributes merely containing the words player_data are not
 * player elements. Matching video.id later avoids selecting an unrelated
 * recommendation when a page contains more than one player.
 */
function playerDataAttributes(html: string): string[] {
  const stack: DefaultTreeAdapterMap['node'][] = [parse(html)];
  const candidates: string[] = [];

  while (stack.length > 0) {
    const node = stack.pop();
    if (node === undefined) break;

    if ('attrs' in node) {
      const attribute = node.attrs.find((attr) => attr.name === 'player_data');
      if (attribute !== undefined) candidates.push(attribute.value);
    }

    if ('childNodes' in node) stack.push(...node.childNodes);
  }

  return candidates;
}

/** Validate the fields we consume without assuming a fixed quality ladder. */
function isCdaPlayerData(value: unknown): value is CdaPlayerData {
  if (!isRecord(value) || typeof value['id'] !== 'string' || !isRecord(value['video'])) {
    return false;
  }

  const video = value['video'];
  if (typeof video['id'] !== 'string' || !VIDEO_ID.test(video['id'])) return false;

  const optionalStrings = ['duration', 'durationFull', 'quality', 'hash', 'hash2', 'title', 'thumb'];
  if (optionalStrings.some((key) => video[key] !== undefined && typeof video[key] !== 'string')) {
    return false;
  }

  // CDA may explicitly set an absent manifest or direct URL to null.
  const nullableUrls = ['file', 'manifest', 'manifest_cast', 'manifest_apple'];
  if (nullableUrls.some((key) => video[key] != null && typeof video[key] !== 'string')) {
    return false;
  }

  const optionalNumbers = ['ts', 'width', 'height'];
  if (
    optionalNumbers.some(
      (key) =>
        video[key] !== undefined &&
        (typeof video[key] !== 'number' || !Number.isFinite(video[key]) || video[key] < 0),
    )
  ) {
    return false;
  }

  // This is a payload bound, not a list of recognized qualities. New labels
  // and tokens remain valid without a code change, while a corrupt page cannot
  // trigger thousands of RPC requests or put an enormous label in the logs.
  const qualities = video['qualities'];
  if (
    qualities !== undefined &&
    (!isRecord(qualities) ||
      Object.keys(qualities).length > 64 ||
      Object.entries(qualities).some(
        ([label, token]) =>
          label.length === 0 ||
          label.length > 128 ||
          typeof token !== 'string' ||
          token.length === 0 ||
          token.length > 256,
      ))
  ) {
    return false;
  }

  if (
    video['quality_change_in_player'] !== undefined &&
    typeof video['quality_change_in_player'] !== 'boolean'
  ) {
    return false;
  }

  // These values are retained as metadata, but videoGetLink never uses api.key
  // or api.ts in place of video.hash2 and video.ts.
  const api = value['api'];
  const apiFields = ['client', 'client2', 'ts', 'key', 'method'];
  if (
    api !== undefined &&
    (!isRecord(api) || apiFields.some((key) => api[key] !== undefined && typeof api[key] !== 'string'))
  ) {
    return false;
  }

  return true;
}

/**
 * Decode the requested video's public player data.
 *
 * Missing attributes and malformed payloads have distinct client-safe errors.
 * JSON parse failures deliberately do not retain the original body as a cause:
 * it can include signed URLs and access tokens.
 */
export function parseCdaPlayerData(html: string, expectedId: string): CdaPlayerData {
  const candidates = playerDataAttributes(html);
  if (candidates.length === 0) throw new CdaError('CDA_PLAYER_DATA_NOT_FOUND');

  for (const candidate of candidates) {
    let data: unknown;
    try {
      data = JSON.parse(candidate) as unknown;
    } catch {
      continue;
    }

    if (!isCdaPlayerData(data) || data.video.id !== expectedId) continue;

    const result: CdaPlayerData = { ...data, video: { ...data.video } };
    const thumbnail = normalizeCdaUrl(data.video.thumb);
    delete result.video.thumb;
    if (thumbnail !== undefined) result.video.thumb = thumbnail;
    return result;
  }

  throw new CdaError('CDA_PLAYER_DATA_INVALID');
}

/**
 * Infer only formats explicitly identified by the URL path. Query strings may
 * carry signatures or misleading extensions, so they are never used as a MIME
 * hint. Unknown quality labels survive without an invented pixel height.
 */
export function cdaStream(value: unknown, quality?: string): CdaStream | undefined {
  const url = normalizeCdaUrl(value);
  if (url === undefined) return undefined;
  const path = new URL(url).pathname.toLowerCase();
  const type = path.endsWith('.m3u8')
    ? 'hls'
    : path.endsWith('.mpd')
      ? 'dash'
      : path.endsWith('.mp4')
        ? 'mp4'
        : undefined;
  if (type === undefined) return undefined;
  const height = /^(\d+)p$/i.exec(quality ?? '')?.[1];
  const resolution = height === undefined ? undefined : Number(height);
  return {
    url,
    type,
    ...(quality === undefined ? {} : { quality }),
    ...(resolution !== undefined && resolution > 0 && resolution <= 8640 ? { resolution } : {}),
  };
}
