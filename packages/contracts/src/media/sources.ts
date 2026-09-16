import { Type, type Static } from '@sinclair/typebox';
import { IsoDateTime, literalUnion, Uuid } from '../common/index.js';
import { MEDIA_PROVIDER_IDS } from './providers.js';
import { PlaybackDescriptor } from './playback.js';

const ProviderIdSchema = literalUnion(MEDIA_PROVIDER_IDS);

/**
 * Lifecycle of an episode source.
 *
 * Transitions are recorded, never erased: a removed source keeps its row and
 * its moderation history so a later copyright enquiry can be answered. Only
 * `PENDING` and `ACTIVE` are ever playable.
 */
export const SourceStatus = {
  /** Submitted, awaiting moderation. Not shown to viewers. */
  PENDING: 'pending',
  /** Approved and playable. */
  ACTIVE: 'active',
  /** Approved, but the upstream link is currently failing health checks. */
  UNAVAILABLE: 'unavailable',
  /** Moderator disabled it; restorable. */
  DISABLED: 'disabled',
  /** Blocked by provider/domain policy; resubmission of the same key is refused. */
  BLOCKED: 'blocked',
  /** Removed after review. Row retained for audit. */
  REMOVED: 'removed',
  /** Disabled following a rights-holder complaint. */
  COPYRIGHT_CLAIM: 'copyright_claim',
  /** Rejected at moderation, e.g. wrong episode or bad metadata. */
  REJECTED: 'rejected',
} as const;
export type SourceStatus = (typeof SourceStatus)[keyof typeof SourceStatus];
export const SOURCE_STATUSES = Object.values(SourceStatus);

/** Statuses a viewer may ever receive a playback descriptor for. */
export const PLAYABLE_SOURCE_STATUSES: readonly SourceStatus[] = [SourceStatus.ACTIVE];

/**
 * Statuses that permanently bar an identical resource from being resubmitted.
 * Enforced by a partial unique index on (provider, resource_key).
 */
export const RESUBMISSION_BARRED_STATUSES: readonly SourceStatus[] = [
  SourceStatus.BLOCKED,
  SourceStatus.COPYRIGHT_CLAIM,
  SourceStatus.REMOVED,
];

/** Upstream availability, tracked by the health worker. */
export const AvailabilityStatus = {
  UNKNOWN: 'unknown',
  AVAILABLE: 'available',
  UNAVAILABLE: 'unavailable',
  /** Provider forbids or rate-limits checking. We stop probing. */
  NOT_CHECKABLE: 'not_checkable',
} as const;
export type AvailabilityStatus = (typeof AvailabilityStatus)[keyof typeof AvailabilityStatus];
export const AVAILABILITY_STATUSES = Object.values(AvailabilityStatus);

/**
 * Language and quality hints.
 *
 * Every field is nullable and unverified by default. These come from the
 * submitter unless a provider API confirms them — the UI must label them as
 * hints, and nothing may fabricate a value the provider did not supply.
 */
export const SourceKind = {
  SUB: 'sub',
  DUB: 'dub',
  RAW: 'raw',
} as const;
export type SourceKind = (typeof SourceKind)[keyof typeof SourceKind];
export const SOURCE_KINDS = Object.values(SourceKind);

/** BCP-47-ish short codes, constrained to what the catalogue actually uses. */
export const SourceLanguage = {
  PL: 'pl',
  EN: 'en',
  JA: 'ja',
  OTHER: 'other',
} as const;
export type SourceLanguage = (typeof SourceLanguage)[keyof typeof SourceLanguage];
export const SOURCE_LANGUAGES = Object.values(SourceLanguage);

export const QualityHint = {
  SD: 'sd',
  HD_720: '720p',
  FHD_1080: '1080p',
  QHD_1440: '1440p',
  UHD_2160: '2160p',
  UNKNOWN: 'unknown',
} as const;
export type QualityHint = (typeof QualityHint)[keyof typeof QualityHint];
export const QUALITY_HINTS = Object.values(QualityHint);

const LanguageSchema = literalUnion(SOURCE_LANGUAGES);

/**
 * An episode source as a viewer sees it.
 *
 * Absent by design: the submitting user's identity, moderation notes, the
 * internal resource key, and any provider credentials.
 */
export const EpisodeSourceDto = Type.Object({
  id: Uuid,
  provider: ProviderIdSchema,
  /** Host for display, e.g. "cda.pl". Not a constructed playback URL. */
  displayHost: Type.String(),
  kind: literalUnion(SOURCE_KINDS),
  audioLanguage: Type.Union([LanguageSchema, Type.Null()]),
  subtitleLanguage: Type.Union([LanguageSchema, Type.Null()]),
  qualityHint: Type.Union([literalUnion(QUALITY_HINTS), Type.Null()]),
  /** True only when a moderator confirmed the metadata. */
  isVerified: Type.Boolean(),
  /** Whether this provider can render in-page or must open off-site. */
  canEmbed: Type.Boolean(),
  availability: literalUnion(AVAILABILITY_STATUSES),
  addedAt: IsoDateTime,
});
export type EpisodeSourceDto = Static<typeof EpisodeSourceDto>;

export const EpisodeSourceListResponse = Type.Object({
  episodeId: Uuid,
  sources: Type.Array(EpisodeSourceDto),
  /** Server-ranked default. Null when no source is playable. */
  recommendedSourceId: Type.Union([Uuid, Type.Null()]),
});
export type EpisodeSourceListResponse = Static<typeof EpisodeSourceListResponse>;

/* -------------------------------------------------------------------------- */
/* Submission                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Exact wording the submitter must affirm. Stored verbatim alongside the
 * attestation timestamp so the record shows what was actually agreed to.
 */
export const RIGHTS_ATTESTATION_TEXT_PL =
  'Oświadczam, że posiadam niezbędne prawa lub upoważnienie do przesłania i udostępnienia tego źródła.';
export const RIGHTS_ATTESTATION_TEXT_EN =
  'I confirm that I have the necessary rights or authorization to submit and share this source.';

export const SourceSubmissionRequest = Type.Object({
  url: Type.String({ format: 'uri', maxLength: 2048 }),
  kind: literalUnion(SOURCE_KINDS),
  audioLanguage: Type.Optional(Type.Union([LanguageSchema, Type.Null()])),
  subtitleLanguage: Type.Optional(Type.Union([LanguageSchema, Type.Null()])),
  qualityHint: Type.Optional(
    Type.Union([literalUnion(QUALITY_HINTS), Type.Null()]),
  ),
  /**
   * Must be exactly `true`. The API rejects anything else — this is a legal
   * record, so a default or coerced value would make it worthless.
   */
  rightsAttested: Type.Literal(true),
  note: Type.Optional(Type.String({ maxLength: 500 })),
});
export type SourceSubmissionRequest = Static<typeof SourceSubmissionRequest>;

export const SourceSubmissionResponse = Type.Object({
  id: Uuid,
  status: literalUnion(SOURCE_STATUSES),
  provider: ProviderIdSchema,
  normalizedUrl: Type.String({ format: 'uri' }),
  message: Type.String(),
});
export type SourceSubmissionResponse = Static<typeof SourceSubmissionResponse>;

/** Result of parsing a URL, shown before submission so the user can confirm. */
export const SourcePreviewResponse = Type.Object({
  provider: ProviderIdSchema,
  normalizedUrl: Type.String({ format: 'uri' }),
  displayHost: Type.String(),
  canEmbed: Type.Boolean(),
  /** True when this exact resource already exists for the episode. */
  alreadySubmitted: Type.Boolean(),
});
export type SourcePreviewResponse = Static<typeof SourcePreviewResponse>;

/**
 * Playback resolution response for a single episode source.
 *
 * Temporary signed URLs may appear inside `descriptor` when the provider
 * emits `native`. Clients must treat them as ephemeral and refresh via this
 * endpoint when playback fails due to expiry.
 */
export const SourcePlaybackResponse = Type.Object({
  sourceId: Uuid,
  episodeId: Uuid,
  descriptor: PlaybackDescriptor,
  resolvedAt: IsoDateTime,
});
export type SourcePlaybackResponse = Static<typeof SourcePlaybackResponse>;

/* -------------------------------------------------------------------------- */
/* Authoring                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Submitting several sources for one episode at once.
 *
 * An episode routinely has the same release mirrored across providers, and
 * adding them one request at a time means one rights attestation per mirror for
 * what the submitter considers a single act. The attestation is still recorded
 * once per resulting row — it is a legal record about a specific resource — but
 * the submitter affirms it once.
 */
export const SourceBatchSubmissionRequest = Type.Object({
  sources: Type.Array(
    Type.Object({
      url: Type.String({ format: 'uri', maxLength: 2048 }),
      kind: literalUnion(SOURCE_KINDS),
      audioLanguage: Type.Optional(Type.Union([LanguageSchema, Type.Null()])),
      subtitleLanguage: Type.Optional(Type.Union([LanguageSchema, Type.Null()])),
      qualityHint: Type.Optional(Type.Union([literalUnion(QUALITY_HINTS), Type.Null()])),
      note: Type.Optional(Type.String({ maxLength: 500 })),
    }),
    { minItems: 1, maxItems: 10 },
  ),
  /** Must be exactly `true`. Recorded verbatim against every row created. */
  rightsAttested: Type.Literal(true),
  /** Group to credit. The caller must be a member; the server verifies it. */
  groupId: Type.Optional(Type.Union([Uuid, Type.Null()])),
});
export type SourceBatchSubmissionRequest = Static<typeof SourceBatchSubmissionRequest>;

/** Outcome for one URL in a batch. Partial success is normal and reported. */
export const SourceBatchResultItem = Type.Object({
  url: Type.String(),
  accepted: Type.Boolean(),
  id: Type.Optional(Uuid),
  provider: Type.Optional(ProviderIdSchema),
  status: Type.Optional(literalUnion(SOURCE_STATUSES)),
  /** Present when `accepted` is false. */
  error: Type.Optional(Type.String()),
});
export type SourceBatchResultItem = Static<typeof SourceBatchResultItem>;

export const SourceBatchSubmissionResponse = Type.Object({
  episodeId: Uuid,
  results: Type.Array(SourceBatchResultItem),
  acceptedCount: Type.Integer({ minimum: 0 }),
  /**
   * True when the accepted sources are visible to viewers already. False means
   * they are queued for moderation.
   */
  publishedImmediately: Type.Boolean(),
});
export type SourceBatchSubmissionResponse = Static<typeof SourceBatchSubmissionResponse>;

/**
 * A source as its submitter sees it, including rows viewers cannot see.
 *
 * Distinct from `EpisodeSourceDto`, which is the public shape: this one carries
 * the moderation status and the rejection reason, so a submitter can tell why
 * their pending source has not appeared.
 */
export const OwnedSourceDto = Type.Object({
  ...EpisodeSourceDto.properties,
  status: literalUnion(SOURCE_STATUSES),
  canonicalUrl: Type.String({ format: 'uri' }),
  moderationNote: Type.Union([Type.String(), Type.Null()]),
  submittedByUsername: Type.Union([Type.String(), Type.Null()]),
  groupName: Type.Union([Type.String(), Type.Null()]),
});
export type OwnedSourceDto = Static<typeof OwnedSourceDto>;

export const OwnedSourceListResponse = Type.Object({
  episodeId: Uuid,
  sources: Type.Array(OwnedSourceDto),
});
export type OwnedSourceListResponse = Static<typeof OwnedSourceListResponse>;

export const SourceUpdateBody = Type.Object({
  kind: Type.Optional(literalUnion(SOURCE_KINDS)),
  audioLanguage: Type.Optional(Type.Union([LanguageSchema, Type.Null()])),
  subtitleLanguage: Type.Optional(Type.Union([LanguageSchema, Type.Null()])),
  qualityHint: Type.Optional(Type.Union([literalUnion(QUALITY_HINTS), Type.Null()])),
});
export type SourceUpdateBody = Static<typeof SourceUpdateBody>;
