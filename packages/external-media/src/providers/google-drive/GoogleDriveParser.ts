import type { GoogleDriveSource, GoogleDriveStreamVariant } from './GoogleDriveTypes.js';
import { normalizeResolution, sortAndDedupeVariants } from './GoogleDriveQualities.js';
import {
  GOOGLE_DRIVE_FILE_ID,
  GOOGLE_DRIVE_RESOURCE_KEY,
  buildGoogleDriveViewUrl,
  isGoogleDriveFileId,
  isGoogleDriveMediaHost,
  isGoogleDrivePageHost,
  isGoogleDriveResourceKey,
} from './GoogleDriveUrls.js';

/* -------------------------------------------------------------------------- */
/* URL parsing                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Extracts a Drive file id from the documented share URL shapes.
 *
 * Uses the URL parser rather than string splitting so query encoding,
 * fragments, and path normalization are handled correctly.
 */
export function extractGoogleDriveFileId(url: URL): string | null {
  if (!isGoogleDrivePageHost(url.hostname)) return null;

  const segments = url.pathname.split('/').filter(Boolean);

  // /file/d/{fileId}/view · /file/d/{fileId}/preview · /file/d/{fileId}/edit
  const fileIndex = segments.indexOf('d');
  if (fileIndex >= 0 && segments[fileIndex - 1] === 'file') {
    const candidate = segments[fileIndex + 1];
    if (candidate !== undefined && GOOGLE_DRIVE_FILE_ID.test(candidate)) return candidate;
  }

  // /open?id= · /uc?id= · /download?id=
  const queryId = url.searchParams.get('id');
  if (queryId !== null && GOOGLE_DRIVE_FILE_ID.test(queryId)) return queryId;

  return null;
}

export function extractGoogleDriveResourceKey(url: URL): string | undefined {
  const raw = url.searchParams.get('resourcekey') ?? url.searchParams.get('resourceKey');
  if (raw === null) return undefined;
  return GOOGLE_DRIVE_RESOURCE_KEY.test(raw) ? raw : undefined;
}

export function parseGoogleDriveUrl(url: URL): GoogleDriveSource | null {
  const fileId = extractGoogleDriveFileId(url);
  if (fileId === null) return null;

  const resourceKey = extractGoogleDriveResourceKey(url);

  return {
    provider: 'google-drive',
    fileId,
    originalUrl: url.toString(),
    ...(resourceKey === undefined ? {} : { resourceKey }),
  };
}

export function toCanonicalGoogleDriveUrl(source: GoogleDriveSource): string {
  return buildGoogleDriveViewUrl(source.fileId, source.resourceKey);
}

export function assertValidGoogleDriveIdentity(
  fileId: string,
  resourceKey: string | null | undefined,
): { fileId: string; resourceKey?: string } | null {
  if (!isGoogleDriveFileId(fileId)) return null;

  if (resourceKey === null || resourceKey === undefined || resourceKey === '') {
    return { fileId };
  }

  if (!isGoogleDriveResourceKey(resourceKey)) return { fileId };
  return { fileId, resourceKey };
}

/* -------------------------------------------------------------------------- */
/* Player response parsing                                                     */
/* -------------------------------------------------------------------------- */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function asFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export function asInteger(value: unknown): number | undefined {
  const number = asFiniteNumber(value);
  if (number === undefined) return undefined;
  const integer = Math.trunc(number);
  return Number.isFinite(integer) ? integer : undefined;
}

function acceptMediaUrl(value: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return undefined;
  }

  if (parsed.protocol !== 'https:') return undefined;
  if (!isGoogleDriveMediaHost(parsed.hostname)) return undefined;
  return parsed.toString();
}

function variantFromParts(input: {
  readonly url: unknown;
  readonly itag?: unknown;
  readonly height?: unknown;
  readonly mimeType?: unknown;
  readonly contentLength?: unknown;
}): GoogleDriveStreamVariant | undefined {
  const rawUrl = asString(input.url);
  if (rawUrl === undefined) return undefined;

  const src = acceptMediaUrl(rawUrl);
  if (src === undefined) return undefined;

  const itag = asInteger(input.itag);
  const resolution = normalizeResolution(asInteger(input.height), itag ?? undefined);
  const mimeType = asString(input.mimeType);
  const contentLength = asInteger(input.contentLength);

  return {
    src,
    ...(resolution === undefined ? {} : { resolution }),
    ...(mimeType === undefined ? {} : { mimeType }),
    ...(itag === undefined ? {} : { itag }),
    ...(contentLength === undefined ? {} : { contentLength }),
  };
}

function readTranscode(entry: unknown): GoogleDriveStreamVariant | undefined {
  if (!isRecord(entry)) return undefined;

  const metadata = isRecord(entry['transcodeMetadata']) ? entry['transcodeMetadata'] : undefined;

  return variantFromParts({
    url: entry['url'],
    itag: entry['itag'],
    height: metadata?.['height'] ?? entry['height'],
    mimeType: metadata?.['mimeType'] ?? entry['mimeType'] ?? entry['mime'],
    contentLength: metadata?.['contentLength'] ?? entry['contentLength'],
  });
}

function collectTranscodes(value: unknown): GoogleDriveStreamVariant[] {
  if (!Array.isArray(value)) return [];
  const variants: GoogleDriveStreamVariant[] = [];
  for (const entry of value) {
    const variant = readTranscode(entry);
    if (variant !== undefined) variants.push(variant);
  }
  return variants;
}

/**
 * Parses the JSON body of Drive's own web-player playback API:
 * `content-workspacevideo-pa.googleapis.com/v1/drive/media/{id}/playback`.
 *
 * Progressive transcodes are muxed files suitable for `<video>`. Adaptive
 * transcodes are typically split audio/video and are ignored for native
 * playback — Google's viewer still handles those via the preview iframe.
 */
export function parsePlaybackApiBody(body: unknown): {
  readonly streams: GoogleDriveStreamVariant[];
  readonly durationSeconds?: number;
  readonly title?: string;
} | undefined {
  if (!isRecord(body)) return undefined;

  const streaming = isRecord(body['mediaStreamingData']) ? body['mediaStreamingData'] : undefined;
  const formatData = isRecord(streaming?.['formatStreamingData'])
    ? streaming['formatStreamingData']
    : undefined;

  const progressive = collectTranscodes(formatData?.['progressiveTranscodes']);
  const streams = sortAndDedupeVariants(progressive);

  const metadata = isRecord(body['mediaMetadata']) ? body['mediaMetadata'] : undefined;
  const durationSeconds = parseDuration(metadata?.['duration']);
  const title = asString(metadata?.['title']);

  return {
    streams,
    ...(durationSeconds === undefined ? {} : { durationSeconds }),
    ...(title === undefined ? {} : { title }),
  };
}

export function parseGoogleApiError(body: unknown): {
  readonly code?: number;
  readonly status?: string;
  readonly message?: string;
} | undefined {
  if (!isRecord(body)) return undefined;
  const error = body['error'];
  if (!isRecord(error)) return undefined;

  const code = asInteger(error['code']);
  const status = asString(error['status']);
  const message = asString(error['message']);

  return {
    ...(code === undefined ? {} : { code }),
    ...(status === undefined ? {} : { status }),
    ...(message === undefined ? {} : { message }),
  };
}

export function parseDuration(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;

  const raw = asString(value);
  if (raw === undefined) return undefined;

  const secondsMatch = /^(\d+(?:\.\d+)?)s$/.exec(raw);
  if (secondsMatch?.[1] !== undefined) return Number.parseFloat(secondsMatch[1]);

  const clock = /^(?:(\d+):)?(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/.exec(raw);
  if (clock) {
    const hours = Number.parseInt(clock[1] ?? '0', 10);
    const minutes = Number.parseInt(clock[2] ?? '0', 10);
    const seconds = Number.parseFloat(clock[3] ?? '0');
    return hours * 3600 + minutes * 60 + seconds;
  }

  const numeric = Number.parseFloat(raw);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : undefined;
}

function decodeMaybe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseFmtStreamMap(value: string): GoogleDriveStreamVariant[] {
  const variants: GoogleDriveStreamVariant[] = [];

  for (const part of value.split(',')) {
    const separator = part.indexOf('|');
    if (separator <= 0) continue;
    const itag = Number.parseInt(part.slice(0, separator), 10);
    const url = decodeMaybe(part.slice(separator + 1));
    const variant = variantFromParts({ url, itag: Number.isFinite(itag) ? itag : undefined });
    if (variant !== undefined) variants.push(variant);
  }

  return variants;
}

function parseUrlEncodedFmtStreamMap(value: string): GoogleDriveStreamVariant[] {
  const variants: GoogleDriveStreamVariant[] = [];

  for (const part of value.split(',')) {
    const params = new URLSearchParams(part);
    const variant = variantFromParts({
      url: params.get('url') ?? undefined,
      itag: params.get('itag') ?? undefined,
      mimeType: params.get('type') ?? params.get('mime') ?? undefined,
    });
    if (variant !== undefined) variants.push(variant);
  }

  return variants;
}

function parseFmtList(value: string): ReadonlyMap<number, number> {
  const resolutions = new Map<number, number>();

  for (const part of value.split(',')) {
    const match = /^(\d+)\/(\d+)x(\d+)/i.exec(part.trim());
    if (match?.[1] === undefined || match[3] === undefined) continue;
    const itag = Number.parseInt(match[1], 10);
    const height = Number.parseInt(match[3], 10);
    if (Number.isFinite(itag) && Number.isFinite(height) && height > 0) {
      resolutions.set(itag, height);
    }
  }

  return resolutions;
}

function applyFmtList(
  variants: readonly GoogleDriveStreamVariant[],
  fmtList: ReadonlyMap<number, number>,
): GoogleDriveStreamVariant[] {
  if (fmtList.size === 0) return [...variants];

  return variants.map((variant) => {
    if (variant.itag === undefined) return variant;
    const height = fmtList.get(variant.itag);
    if (height === undefined) return variant;
    return { ...variant, resolution: height };
  });
}

/**
 * Parses `application/x-www-form-urlencoded` bodies from Drive's
 * `get_video_info` endpoint — the same form the classic Drive player used.
 */
export function parseVideoInfoBody(body: string): {
  readonly streams: GoogleDriveStreamVariant[];
  readonly durationSeconds?: number;
  readonly status: string | undefined;
  readonly reason: string | undefined;
} {
  const params = new URLSearchParams(body);
  const status = params.get('status') ?? undefined;
  const reason = params.get('reason') ?? undefined;

  const encodedMap = params.get('url_encoded_fmt_stream_map');
  const fmtMap = params.get('fmt_stream_map');
  const fmtList = parseFmtList(params.get('fmt_list') ?? '');

  const fromEncoded = encodedMap !== null ? parseUrlEncodedFmtStreamMap(encodedMap) : [];
  const fromFmt = fmtMap !== null ? parseFmtStreamMap(fmtMap) : [];
  const merged = applyFmtList(fromEncoded.length > 0 ? fromEncoded : fromFmt, fmtList);

  const length = params.get('length_seconds');
  const durationSeconds = parseDuration(length);

  return {
    streams: sortAndDedupeVariants(merged),
    ...(durationSeconds === undefined ? {} : { durationSeconds }),
    status,
    reason,
  };
}

function unescapeJsonString(value: string): string {
  return value
    .replaceAll('\\/', '/')
    .replaceAll('\\u003d', '=')
    .replaceAll('\\u0026', '&')
    .replaceAll('\\u003c', '<')
    .replaceAll('\\u003e', '>')
    .replaceAll(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    );
}

/**
 * Last-resort extraction from the Drive viewer HTML. Only looks for the
 * documented player fields (`fmt_stream_map` / `url_encoded_fmt_stream_map`).
 */
export function parseViewerHtml(html: string): GoogleDriveStreamVariant[] {
  const encoded =
    /"url_encoded_fmt_stream_map"\s*(?:,\s*"|":\s*")([^"]+)"/.exec(html)?.[1] ??
    /url_encoded_fmt_stream_map["']?\s*[:=]\s*["']([^"']+)/.exec(html)?.[1];

  if (encoded !== undefined) {
    const variants = parseUrlEncodedFmtStreamMap(unescapeJsonString(encoded));
    if (variants.length > 0) return sortAndDedupeVariants(variants);
  }

  const fmt =
    /"fmt_stream_map"\s*(?:,\s*"|":\s*")([^"]+)"/.exec(html)?.[1] ??
    /fmt_stream_map["']?\s*[:=]\s*["']([^"']+)/.exec(html)?.[1];

  if (fmt !== undefined) {
    return sortAndDedupeVariants(parseFmtStreamMap(unescapeJsonString(fmt)));
  }

  return [];
}

export function looksLikeAccessDeniedPage(html: string): boolean {
  const lowered = html.toLowerCase();
  return (
    lowered.includes('you need access') ||
    lowered.includes('request access') ||
    lowered.includes('accounts.google.com/servicelogin') ||
    (lowered.includes('not found') && lowered.includes('sorry'))
  );
}

export function looksLikeNotFoundPage(html: string): boolean {
  const lowered = html.toLowerCase();
  return (
    lowered.includes('file not found') ||
    (lowered.includes('404') && lowered.includes('sorry, the file'))
  );
}
