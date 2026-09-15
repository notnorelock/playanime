import type {
  AvailabilityStatus,
  MediaProviderId,
  PlaybackDescriptor,
  ProviderEmbedPolicy,
  QualityHint,
  SourceLanguage,
} from '@playanime/contracts';

/**
 * The result of recognizing and parsing a URL.
 *
 * `resourceKey` is the stable identity of the resource at the provider — for
 * YouTube the video id, for Drive the file id. Together with the provider id it
 * forms the uniqueness key used to deduplicate submissions and to bar
 * resubmission of a blocked resource.
 */
export interface ParsedExternalMedia {
  readonly provider: MediaProviderId;
  /** Provider-side identifier. Stable across URL formats for the same resource. */
  readonly externalId: string;
  /**
   * Secondary access parameter some providers require, e.g. a Google Drive
   * `resourceKey`. Part of the link the owner shared — never a bypass of
   * anything, and never derived by PlayAnime.
   */
  readonly resourceKey?: string;
  /** Canonical, normalized URL. What gets stored and displayed. */
  readonly canonicalUrl: string;
  /** Hostname for display. */
  readonly displayHost: string;
  /** Start offset when the shared link carried one (e.g. `?t=90`). */
  readonly startSeconds?: number;
  /**
   * Provider-specific fields that do not deserve relational columns.
   * Persisted as JSONB. Must stay small and must never hold credentials.
   */
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

/** Stored source, as provider code sees it. No database types cross this line. */
export interface ExternalMediaSource {
  readonly id: string;
  readonly provider: MediaProviderId;
  readonly externalId: string;
  readonly resourceKey: string | null;
  readonly canonicalUrl: string;
  readonly audioLanguage: SourceLanguage | null;
  readonly subtitleLanguage: SourceLanguage | null;
  readonly qualityHint: QualityHint | null;
  readonly metadata: Readonly<Record<string, unknown>>;
}

/**
 * Request-scoped context for playback resolution.
 *
 * Carries viewer preferences that legitimately shape the embed URL (locale for
 * the player chrome, autoplay intent). It carries no credentials and nothing
 * that could be used to impersonate a viewer to a provider.
 */
export interface PlaybackContext {
  /** Origin embedding the iframe, for providers that scope embeds by origin. */
  readonly embedOrigin: string;
  readonly locale: string;
  readonly autoplay: boolean;
  /** Resume offset in seconds, from the viewer's stored progress. */
  readonly startSeconds?: number;
}

export interface SourceAvailability {
  readonly status: AvailabilityStatus;
  readonly checkedAt: Date;
  /** Present when the provider gave a machine-readable reason. */
  readonly detail?: string;
}

/** Static description of a provider. Drives policy decisions outside the class. */
export interface ProviderDefinition {
  readonly id: MediaProviderId;
  /** Human-readable name for the UI. */
  readonly label: string;
  /** Hostnames this provider claims, without `www.`. Exact or suffix matched. */
  readonly hosts: readonly string[];
  /**
   * Hosts permitted on native media `src` URLs. Defaults to `hosts` when
   * omitted. Drive uses this for `*.googlevideo.com` / `*.drive.google.com`
   * playback endpoints that differ from the share-link hosts.
   */
  readonly mediaHosts?: readonly string[];
  readonly embedPolicy: ProviderEmbedPolicy;
  /**
   * Whether this provider may emit `type: "native"` descriptors.
   *
   * Granted only when the provider exposes playback variants to the current
   * viewer through its own player surfaces — never as a licence to decrypt
   * DRM, forge signatures, or read a file the caller cannot open.
   */
  readonly canEmitNative: boolean;
  /**
   * Whether lightweight availability checks are permitted, using the provider's
   * own metadata API. `false` means we do not probe this provider at all.
   */
  readonly supportsAvailabilityCheck: boolean;
  /** Default ranking weight. Higher sorts first; overridable per deployment. */
  readonly reliabilityWeight: number;
  /** Why this provider is link-only, shown in the moderation UI. */
  readonly embedNote?: string;
}

/**
 * A third-party media provider.
 *
 * `supports` and `parse` are pure. `resolvePlayback` may perform network I/O
 * when the provider needs to resolve temporary playback metadata for an
 * already-accessible resource. It must never download media bytes.
 */
export interface ExternalMediaProvider {
  readonly definition: ProviderDefinition;

  /** Whether this provider claims the URL. Host matching only; never fetches. */
  supports(url: URL): boolean;

  /**
   * Extracts provider-side identity. Returns `null` when the URL belongs to
   * this provider's host but is not a playable resource — a channel page, a
   * search result, a malformed share link.
   */
  parse(url: URL): ParsedExternalMedia | null;

  /**
   * Produces the descriptor the player consumes.
   *
   * Returns `external` whenever the provider has no verified embed mechanism,
   * and `unavailable` when the resource cannot be presented at all.
   */
  resolvePlayback(
    source: ExternalMediaSource,
    context: PlaybackContext,
  ): PlaybackDescriptor | Promise<PlaybackDescriptor>;

  /**
   * Optional lightweight liveness check against a documented metadata endpoint.
   *
   * Must never download media. Implementations are expected to respect provider
   * rate limits; the calling worker applies exponential backoff.
   */
  checkAvailability?(source: ExternalMediaSource): Promise<SourceAvailability>;
}
