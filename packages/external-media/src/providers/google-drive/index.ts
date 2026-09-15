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
 * Google Drive.
 *
 * Integration is limited to Drive's own documented viewer:
 * `https://drive.google.com/file/d/{fileId}/preview`, which is the embed form
 * Google publishes for Drive-hosted files.
 *
 * ## Access control
 *
 * Possessing a `fileId` says nothing about permission. Drive enforces sharing
 * settings on the *viewer's* own Google session inside the iframe: if the file
 * is private, the frame shows Google's own "request access" page. That is the
 * correct outcome, and PlayAnime does nothing to alter it.
 *
 * `resourceKey` is part of the share link Google generates for files under
 * resource-key protection; it is supplied by whoever submitted the link, never
 * derived or guessed. It is forwarded in the documented manner so a legitimately
 * shared link keeps working.
 *
 * ## What is deliberately absent
 *
 * - No `uc?export=download` URL construction. That is a download endpoint, not
 *   a playback one, and using it would route bytes around Drive's quotas.
 * - No extraction of `videoplayback` or any internal stream URL.
 * - No attempt to read files the authenticated caller cannot access.
 *
 * Optional metadata enrichment (title, mimeType, capabilities) is available
 * through Google's official Drive API in the API layer, using PlayAnime's own
 * key, and only returns what that key is permitted to see.
 */

/** Drive file ids are opaque; this matches the documented character set. */
const FILE_ID = /^[A-Za-z0-9_-]{10,200}$/;
const RESOURCE_KEY = /^[A-Za-z0-9_-]{1,100}$/;

export const googleDriveDefinition: ProviderDefinition = {
  id: MediaProviderId.GOOGLE_DRIVE,
  label: 'Google Drive',
  hosts: ['drive.google.com', 'docs.google.com'],
  embedPolicy: ProviderEmbedPolicy.EMBED,
  canEmitNative: false,
  // Possible via the official Drive API, but only when a key is configured and
  // only for files that key may see. The worker treats 404/403 as "not
  // checkable" rather than "gone", since absence of permission is not absence.
  supportsAvailabilityCheck: true,
  reliabilityWeight: 60,
};

/** Extracts a file id from the documented Drive URL shapes. */
function extractFileId(url: URL): string | null {
  const segments = url.pathname.split('/').filter(Boolean);

  // /file/d/{fileId}/view  ·  /file/d/{fileId}/preview
  const fileIndex = segments.indexOf('d');
  if (fileIndex >= 0) {
    const candidate = segments[fileIndex + 1];
    if (candidate !== undefined && FILE_ID.test(candidate)) return candidate;
  }

  // /open?id={fileId}  ·  /uc?id={fileId}
  const queryId = url.searchParams.get('id');
  if (queryId !== null && FILE_ID.test(queryId)) return queryId;

  return null;
}

export const googleDriveProvider: ExternalMediaProvider = {
  definition: googleDriveDefinition,

  supports(url: URL): boolean {
    return hostMatches(url.hostname, googleDriveDefinition.hosts);
  },

  parse(url: URL): ParsedExternalMedia | null {
    const fileId = extractFileId(url);
    if (fileId === null) return null;

    // Only accept a well-formed key; a malformed one is dropped rather than
    // forwarded, so nothing unvalidated reaches the embed URL.
    const rawKey = url.searchParams.get('resourcekey') ?? url.searchParams.get('resourceKey');
    const resourceKey = rawKey !== null && RESOURCE_KEY.test(rawKey) ? rawKey : undefined;

    const canonical = new URL(`https://drive.google.com/file/d/${fileId}/view`);
    if (resourceKey !== undefined) canonical.searchParams.set('resourcekey', resourceKey);

    return {
      provider: MediaProviderId.GOOGLE_DRIVE,
      externalId: fileId,
      ...(resourceKey === undefined ? {} : { resourceKey }),
      canonicalUrl: canonical.toString(),
      displayHost: 'drive.google.com',
    };
  },

  resolvePlayback(source: ExternalMediaSource, _context: PlaybackContext): PlaybackDescriptor {
    if (!FILE_ID.test(source.externalId)) {
      return {
        type: 'unavailable',
        provider: MediaProviderId.GOOGLE_DRIVE,
        reason: 'provider_not_supported',
      };
    }

    const preview = new URL(`https://drive.google.com/file/d/${source.externalId}/preview`);

    if (source.resourceKey !== null && RESOURCE_KEY.test(source.resourceKey)) {
      preview.searchParams.set('resourcekey', source.resourceKey);
    }

    return {
      type: 'iframe',
      provider: MediaProviderId.GOOGLE_DRIVE,
      url: preview.toString(),
      // Drive's viewer needs fullscreen; it does not need autoplay or sensors.
      allow: 'autoplay; encrypted-media; fullscreen',
      // The Drive viewer authenticates the viewer against their own Google
      // session, which requires access to Google's cookies in the frame.
      requiresSameOrigin: true,
      aspectRatio: 16 / 9,
    };
  },
};
