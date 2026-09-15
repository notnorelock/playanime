import { hostMatches } from '../../validation/url.js';

/**
 * Drive file ids are opaque tokens. The character set is the one Google
 * publishes for file ids; length covers both the older 28-char ids and the
 * longer ones currently issued.
 */
export const GOOGLE_DRIVE_FILE_ID = /^[A-Za-z0-9_-]{10,200}$/;
export const GOOGLE_DRIVE_RESOURCE_KEY = /^[A-Za-z0-9_-]{1,100}$/;

export const GOOGLE_DRIVE_PAGE_HOSTS = [
  'drive.google.com',
  'docs.google.com',
  'drive.usercontent.google.com',
] as const;

/**
 * Hosts that may appear on temporary `videoplayback` URLs the Drive player
 * itself requests. Suffix-matched, so `rr5---sn-xxx.c.drive.google.com` is
 * accepted via `drive.google.com`.
 */
export const GOOGLE_DRIVE_MEDIA_HOSTS = [
  'drive.google.com',
  'docs.google.com',
  'googlevideo.com',
] as const;

export const GOOGLE_DRIVE_PREVIEW_ALLOW =
  'autoplay; encrypted-media; fullscreen; picture-in-picture';

export function isGoogleDriveFileId(value: string): boolean {
  return GOOGLE_DRIVE_FILE_ID.test(value);
}

export function isGoogleDriveResourceKey(value: string): boolean {
  return GOOGLE_DRIVE_RESOURCE_KEY.test(value);
}

export function isGoogleDrivePageHost(hostname: string): boolean {
  return hostMatches(hostname, GOOGLE_DRIVE_PAGE_HOSTS);
}

export function isGoogleDriveMediaHost(hostname: string): boolean {
  return hostMatches(hostname, GOOGLE_DRIVE_MEDIA_HOSTS);
}

export function buildGoogleDrivePreviewUrl(fileId: string, resourceKey?: string): string {
  const preview = new URL(`https://drive.google.com/file/d/${fileId}/preview`);
  if (resourceKey !== undefined) preview.searchParams.set('resourcekey', resourceKey);
  return preview.toString();
}

export function buildGoogleDriveViewUrl(fileId: string, resourceKey?: string): string {
  const view = new URL(`https://drive.google.com/file/d/${fileId}/view`);
  if (resourceKey !== undefined) view.searchParams.set('resourcekey', resourceKey);
  return view.toString();
}

/**
 * Origin + path only. Query strings on Drive media URLs carry signatures and
 * must never be logged or persisted.
 */
export function describeMediaUrl(value: string): string {
  try {
    const parsed = new URL(value);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return '[invalid-url]';
  }
}

export function isLikelySignedPlaybackUrl(value: string): boolean {
  return value.includes('videoplayback') || /[?&](?:sig|signature|expire)=/.test(value);
}
