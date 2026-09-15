/**
 * Provider identity and the platform-wide allowlist.
 *
 * PlayAnime does not host video. Every playable source is a link to a
 * third-party provider, and this file is the single place that decides which
 * providers exist at all. Nothing else in the codebase may widen this set.
 */

export const MediaProviderId = {
  YOUTUBE: 'youtube',
  GOOGLE_DRIVE: 'google-drive',
  CDA: 'cda',
  VIDOZA: 'vidoza',
  MP4UPLOAD: 'mp4upload',
  SIBNET: 'sibnet',
  /** Recognized link with no dedicated integration. Always opens off-site. */
  EXTERNAL_LINK: 'external-link',
} as const;
export type MediaProviderId = (typeof MediaProviderId)[keyof typeof MediaProviderId];
export const MEDIA_PROVIDER_IDS = Object.values(MediaProviderId);

export const isMediaProviderId = (value: string): value is MediaProviderId =>
  (MEDIA_PROVIDER_IDS as readonly string[]).includes(value);

/**
 * How a provider may be presented to the viewer.
 *
 * `EMBED` is granted only to providers with a documented, publicly supported
 * embed mechanism. Everything else is `LINK_ONLY`: PlayAnime sends the viewer
 * to the provider's own page rather than attempting to frame content the
 * provider has not offered for framing.
 */
export const ProviderEmbedPolicy = {
  /** Documented embed endpoint; may render in a sandboxed iframe. */
  EMBED: 'embed',
  /** No verified embed mechanism. Renders as "Open on provider". */
  LINK_ONLY: 'link_only',
} as const;
export type ProviderEmbedPolicy = (typeof ProviderEmbedPolicy)[keyof typeof ProviderEmbedPolicy];

/** Why a source cannot be played. Rendered as user-facing copy by the web app. */
export const UnavailableReason = {
  PROVIDER_NOT_SUPPORTED: 'provider_not_supported',
  PROVIDER_DISABLED: 'provider_disabled',
  SOURCE_PENDING_REVIEW: 'source_pending_review',
  SOURCE_REJECTED: 'source_rejected',
  SOURCE_DISABLED: 'source_disabled',
  SOURCE_BLOCKED: 'source_blocked',
  SOURCE_REMOVED: 'source_removed',
  COPYRIGHT_CLAIM: 'copyright_claim',
  UPSTREAM_UNAVAILABLE: 'upstream_unavailable',
  REGION_RESTRICTED: 'region_restricted',
  REQUIRES_PROVIDER_PERMISSION: 'requires_provider_permission',
} as const;
export type UnavailableReason = (typeof UnavailableReason)[keyof typeof UnavailableReason];
