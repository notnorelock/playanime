import { Type, type Static } from '@sinclair/typebox';
import { IsoDateTime, Slug, Uuid, literalUnion } from '../common/index.js';
import {
  AGE_RATINGS,
  ENTRY_RELATION_TYPES,
  ENTRY_TYPES,
  EPISODE_CREDIT_ROLES,
  MEDIA_ASSET_KINDS,
  RELEASE_STATUSES,
  SEASONS_OF_YEAR,
} from '../anime/enums.js';

/**
 * Catalogue authoring.
 *
 * Creating a title is not the same kind of act as submitting a source. A source
 * points at one episode and can be disabled without trace; a title is global,
 * its slug is permanent, and every library entry and rating hangs off it. These
 * schemas are therefore stricter about what must be supplied up front, and the
 * server records who created each row.
 *
 * The catalogue is `Series -> Entry -> Episode`: a Series ("Attack on
 * Titan") is the rateable/listable unit; an Entry is one watchable release
 * under it (a season, a cour, a movie, an OVA...). Every Entry belongs to
 * exactly one Series — a standalone film still gets a (single-Entry)
 * Series wrapper, so there is no separate "create a bare title" path.
 */

/* -------------------------------------------------------------------------- */
/* Entries (releases)                                                          */
/* -------------------------------------------------------------------------- */

export const EntryCreateBody = Type.Object({
  entryType: literalUnion(ENTRY_TYPES),

  /**
   * Canonical romaji title for this release. Required because it is the
   * one title every query can rely on and the one the entry's own slug
   * is derived from.
   */
  titleRomaji: Type.String({ minLength: 1, maxLength: 255 }),
  titleEnglish: Type.Optional(Type.Union([Type.String({ maxLength: 255 }), Type.Null()])),
  titleNative: Type.Optional(Type.Union([Type.String({ maxLength: 255 }), Type.Null()])),

  synopsis: Type.Optional(Type.Union([Type.String({ maxLength: 10000 }), Type.Null()])),

  status: Type.Optional(literalUnion(RELEASE_STATUSES)),

  /**
   * Series-internal sequence (e.g. 2 for "Season 2") — never required,
   * never implied by `entryType`. Null for a movie/OVA/special unless
   * the show genuinely numbers those too.
   */
  seasonNumber: Type.Optional(Type.Union([Type.Integer({ minimum: 1, maximum: 999 }), Type.Null()])),
  /** Only meaningful alongside `seasonNumber` — rejected otherwise (see `courNumber` doc on the entries table). */
  courNumber: Type.Optional(Type.Union([Type.Integer({ minimum: 1, maximum: 99 }), Type.Null()])),

  /** Broadcast season-of-year — unrelated to `seasonNumber` above. */
  airingSeason: Type.Optional(Type.Union([literalUnion(SEASONS_OF_YEAR), Type.Null()])),
  airingYear: Type.Optional(
    Type.Union([Type.Integer({ minimum: 1900, maximum: 2200 }), Type.Null()]),
  ),

  startDate: Type.Optional(Type.Union([Type.String({ format: 'date' }), Type.Null()])),
  endDate: Type.Optional(Type.Union([Type.String({ format: 'date' }), Type.Null()])),

  episodeCount: Type.Optional(Type.Union([Type.Integer({ minimum: 0, maximum: 10000 }), Type.Null()])),
  durationMinutes: Type.Optional(Type.Union([Type.Integer({ minimum: 0, maximum: 1000 }), Type.Null()])),

  ageRating: Type.Optional(Type.Union([literalUnion(AGE_RATINGS), Type.Null()])),
  /** Gates the title behind the viewer's mature-content preference. */
  isAdult: Type.Optional(Type.Boolean()),
  /**
   * Gates the whole entry behind an active VIP grant. Accepted here so the
   * ordinary "add/edit anime" form can offer it directly, but it is a
   * staff-only editorial choice the same way it already was through
   * `AdminEntryUpdateBody` — the service layer silently drops this field
   * for a non-staff caller rather than trusting the client not to send it.
   */
  vipOnly: Type.Optional(Type.Boolean()),

  /**
   * Genre NAMES, not slugs — a genre that doesn't exist yet is created on
   * demand, same as `tags` below. Genres started as a small hand-curated
   * list matched by slug with an unknown one rejected outright; a
   * translator can now add a new one directly while authoring, same as
   * a tag, so this accepts a name for the same reason `tags` does.
   */
  genres: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 64 }), { maxItems: 20 })),
  /** Studio names. Created on demand if not already known. */
  studios: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 200 }), { maxItems: 10 })),
  /**
   * Tag names, not slugs — a tag that doesn't exist yet is created on
   * demand (same `resolveOrCreateTaxonomy` an AniList sync already
   * uses), since tags are AniList's large free-form set, not a short
   * hand-curated list an unknown value could reasonably be rejected
   * against.
   */
  tags: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 100 }), { maxItems: 30 })),

  posterUrl: Type.Optional(Type.Union([Type.String({ format: 'uri', maxLength: 2048 }), Type.Null()])),
  bannerUrl: Type.Optional(Type.Union([Type.String({ format: 'uri', maxLength: 2048 }), Type.Null()])),

  /** Manual release-order override within the series; null uses date order. */
  releaseOrder: Type.Optional(Type.Union([Type.Integer({ minimum: 0 }), Type.Null()])),
  /** In-universe order, a separate axis; null means unknown — never guessed. */
  chronologicalOrder: Type.Optional(Type.Union([Type.Integer({ minimum: 0 }), Type.Null()])),
  /** Part of the main numbered sequence vs. an extra/spin-off release. Defaults true. */
  isMainEntry: Type.Optional(Type.Boolean()),

  /**
   * Group to credit for adding this entry. The caller must be a member; the
   * server verifies that rather than trusting the id.
   */
  groupId: Type.Optional(Type.Union([Uuid, Type.Null()])),

  /**
   * Set when this entry was created via the AniList autofill picker
   * (`GET /catalogue/anilist-import/:anilistId`) — links the new row to
   * that AniList entry so it can be re-synced later instead of only rows
   * the bulk `packages/importer` CLI creates having one.
   */
  anilistId: Type.Optional(Type.Integer()),
  /**
   * MyAnimeList id, the same equal-status sibling of `anilistId` above —
   * `entries.mal_id` has its own unique-when-not-null index and
   * `requireTitleNotBlocked` already checks both ids equally, but until
   * now only a later AniList re-sync (`syncFromAniList`) could ever set
   * it; creation itself had no way to record an id the autofill response
   * already knows at the moment of creation.
   */
  malId: Type.Optional(Type.Integer()),
});
export type EntryCreateBody = Static<typeof EntryCreateBody>;

/**
 * Entry edits.
 *
 * `titleRomaji` is editable — a typo should be fixable — but the entry's
 * own slug is not, and is never recomputed from it. Changing a slug breaks
 * existing links and is a moderator action performed deliberately.
 */
export const EntryEditBody = Type.Partial(
  Type.Object({
    ...EntryCreateBody.properties,
  }),
);
export type EntryEditBody = Static<typeof EntryEditBody>;

/* -------------------------------------------------------------------------- */
/* Series                                                                      */
/* -------------------------------------------------------------------------- */

export const SeriesCreateBody = Type.Object({
  title: Type.String({ minLength: 1, maxLength: 255 }),
  synopsis: Type.Optional(Type.Union([Type.String({ maxLength: 10000 }), Type.Null()])),
  posterUrl: Type.Optional(Type.Union([Type.String({ format: 'uri', maxLength: 2048 }), Type.Null()])),
  bannerUrl: Type.Optional(Type.Union([Type.String({ format: 'uri', maxLength: 2048 }), Type.Null()])),
  franchiseId: Type.Optional(Type.Union([Uuid, Type.Null()])),
  /**
   * The common case: create a series and its first release in one call,
   * mirroring the old single-step "add anime" flow. Omitted only for the
   * rare authoring path that creates a bare series shell before its
   * first entry is ready.
   */
  firstEntry: Type.Optional(EntryCreateBody),
});
export type SeriesCreateBody = Static<typeof SeriesCreateBody>;

export const SeriesEditBody = Type.Partial(
  Type.Object({
    title: Type.String({ minLength: 1, maxLength: 255 }),
    synopsis: Type.Union([Type.String({ maxLength: 10000 }), Type.Null()]),
    posterUrl: Type.Union([Type.String({ format: 'uri', maxLength: 2048 }), Type.Null()]),
    bannerUrl: Type.Union([Type.String({ format: 'uri', maxLength: 2048 }), Type.Null()]),
    franchiseId: Type.Union([Uuid, Type.Null()]),
  }),
);
export type SeriesEditBody = Static<typeof SeriesEditBody>;

/**
 * A series that may be a duplicate of what is being created.
 *
 * Returned as a warning, not an error: two genuinely different works can share
 * a title, and refusing outright would make legitimate entries impossible.
 */
export const DuplicateTitleWarning = Type.Object({
  id: Uuid,
  slug: Slug,
  title: Type.String(),
  format: Type.Union([literalUnion(ENTRY_TYPES), Type.Null()]),
  seasonYear: Type.Union([Type.Integer(), Type.Null()]),
  /** 0-1. How closely the titles match, by trigram similarity. */
  similarity: Type.Number({ minimum: 0, maximum: 1 }),
});
export type DuplicateTitleWarning = Static<typeof DuplicateTitleWarning>;

export const DuplicateCheckResponse = Type.Object({
  matches: Type.Array(DuplicateTitleWarning),
});
export type DuplicateCheckResponse = Static<typeof DuplicateCheckResponse>;

/* -------------------------------------------------------------------------- */
/* Entry relations                                                             */
/* -------------------------------------------------------------------------- */

export const EntryRelationCreateBody = Type.Object({
  toEntryId: Uuid,
  relationType: literalUnion(ENTRY_RELATION_TYPES),
});
export type EntryRelationCreateBody = Static<typeof EntryRelationCreateBody>;

/* -------------------------------------------------------------------------- */
/* AniList search / autofill                                                  */
/* -------------------------------------------------------------------------- */

/**
 * One AniList search match, for the "add anime" form's live picker —
 * deliberately thin (just enough to render a result card: poster, title,
 * year, format). The full field set is only fetched once an author
 * actually picks a result, via `AnimeAutofillResponse` below, so a
 * dropdown of several results per keystroke stays cheap.
 */
export const AnimeSearchResult = Type.Object({
  anilistId: Type.Integer(),
  titleRomaji: Type.String(),
  titleEnglish: Type.Union([Type.String(), Type.Null()]),
  format: Type.Union([literalUnion(ENTRY_TYPES), Type.Null()]),
  seasonYear: Type.Union([Type.Integer(), Type.Null()]),
  posterUrl: Type.Union([Type.String(), Type.Null()]),
});
export type AnimeSearchResult = Static<typeof AnimeSearchResult>;

export const AnimeSearchResponse = Type.Object({
  results: Type.Array(AnimeSearchResult),
});
export type AnimeSearchResponse = Static<typeof AnimeSearchResponse>;

/**
 * The full autofill payload for one picked AniList result — matches
 * `EntryCreateBody`'s own field shape closely so the frontend can spread
 * this straight into the create form. `genres` is every AniList genre
 * NAME as reported, not resolved against this catalogue's own table —
 * this is a read-only preview so nothing is created here regardless, and
 * `EntryCreateBody.genres` itself now creates an unrecognized one on
 * demand at write time, the same as `tags` already does. `studios`
 * stays free text, matching `EntryCreateBody.studios`'s own "created on
 * demand" contract.
 */
export const AnimeAutofillResponse = Type.Object({
  titleRomaji: Type.String(),
  titleEnglish: Type.Union([Type.String(), Type.Null()]),
  titleNative: Type.Union([Type.String(), Type.Null()]),
  synopsis: Type.Union([Type.String(), Type.Null()]),
  format: literalUnion(ENTRY_TYPES),
  status: literalUnion(RELEASE_STATUSES),
  season: Type.Union([literalUnion(SEASONS_OF_YEAR), Type.Null()]),
  seasonYear: Type.Union([Type.Integer(), Type.Null()]),
  startDate: Type.Union([Type.String({ format: 'date' }), Type.Null()]),
  endDate: Type.Union([Type.String({ format: 'date' }), Type.Null()]),
  episodeCount: Type.Union([Type.Integer(), Type.Null()]),
  durationMinutes: Type.Union([Type.Integer(), Type.Null()]),
  isAdult: Type.Boolean(),
  genres: Type.Array(Type.String()),
  studios: Type.Array(Type.String()),
  /**
   * Tag NAMES, not slugs, and never checked against this catalogue's own
   * tag table — unlike `genres`, which is a read-only preview against a
   * fixed list, a tag is created on demand at write time (`applyTags`),
   * so there is nothing to "already know" here worth checking; every
   * AniList tag name is shown as-is for the author to keep or drop.
   */
  tags: Type.Array(Type.String()),
  posterUrl: Type.Union([Type.String(), Type.Null()]),
  bannerUrl: Type.Union([Type.String(), Type.Null()]),
  /**
   * AniList's own MAL cross-reference, if it has one — carried through so
   * a caller that persists this autofill (creating a title from it) can
   * save both ids without a second AniList round trip.
   */
  malId: Type.Union([Type.Integer(), Type.Null()]),
});
export type AnimeAutofillResponse = Static<typeof AnimeAutofillResponse>;

/* -------------------------------------------------------------------------- */
/* AniList re-sync (existing titles)                                          */
/* -------------------------------------------------------------------------- */

export const AnimeSyncRequest = Type.Object({
  anilistId: Type.Integer(),
});
export type AnimeSyncRequest = Static<typeof AnimeSyncRequest>;

/**
 * Result of syncing an already-existing title against an AniList entry —
 * names what was actually added, not just whether it succeeded, so the
 * author sees something concrete ("Added: Mystery, Psychological") rather
 * than a bare confirmation.
 */
export const AnimeSyncResponse = Type.Object({
  anilistId: Type.Integer(),
  posterUrl: Type.Union([Type.String(), Type.Null()]),
  bannerUrl: Type.Union([Type.String(), Type.Null()]),
  addedGenres: Type.Array(Type.String()),
  addedTags: Type.Array(Type.String()),
  addedStudios: Type.Array(Type.String()),
});
export type AnimeSyncResponse = Static<typeof AnimeSyncResponse>;

export const SeriesCreateResponse = Type.Object({
  id: Uuid,
  slug: Slug,
  /** Present when the call included `firstEntry`. */
  firstEntry: Type.Optional(Type.Object({ id: Uuid, slug: Slug })),
});
export type SeriesCreateResponse = Static<typeof SeriesCreateResponse>;

export const EntryCreateResponse = Type.Object({
  id: Uuid,
  slug: Slug,
});
export type EntryCreateResponse = Static<typeof EntryCreateResponse>;

/**
 * Existing catalogue entry for a given AniList id, or `null` if none exists
 * yet. Backs the AniList-first creation flow (bulk importers included): check
 * this before creating, so a title already linked to that AniList id is
 * reused rather than duplicated.
 */
export const EntryByAnilistResponse = Type.Union([
  Type.Object({
    id: Uuid,
    slug: Slug,
    seriesId: Uuid,
    seriesSlug: Slug,
  }),
  Type.Null(),
]);
export type EntryByAnilistResponse = Static<typeof EntryByAnilistResponse>;

/* -------------------------------------------------------------------------- */
/* Episodes                                                                    */
/* -------------------------------------------------------------------------- */

export const EpisodeCreateBody = Type.Object({
  number: Type.Integer({ minimum: 0, maximum: 10000 }),
  absoluteNumber: Type.Optional(Type.Union([Type.Integer({ minimum: 0 }), Type.Null()])),

  title: Type.Optional(Type.Union([Type.String({ maxLength: 255 }), Type.Null()])),
  synopsis: Type.Optional(Type.Union([Type.String({ maxLength: 5000 }), Type.Null()])),

  airedAt: Type.Optional(Type.Union([Type.String({ format: 'date' }), Type.Null()])),
  durationSeconds: Type.Optional(
    Type.Union([Type.Integer({ minimum: 0, maximum: 86400 }), Type.Null()]),
  ),

  /**
   * Intro and outro markers, driving the skip control. Null means unknown —
   * the player hides the button rather than guessing a range.
   */
  introStartSeconds: Type.Optional(Type.Union([Type.Integer({ minimum: 0 }), Type.Null()])),
  introEndSeconds: Type.Optional(Type.Union([Type.Integer({ minimum: 0 }), Type.Null()])),
  outroStartSeconds: Type.Optional(Type.Union([Type.Integer({ minimum: 0 }), Type.Null()])),

  isFiller: Type.Optional(Type.Boolean()),
  isRecap: Type.Optional(Type.Boolean()),

  thumbnailUrl: Type.Optional(
    Type.Union([Type.String({ format: 'uri', maxLength: 2048 }), Type.Null()]),
  ),

  /**
   * Early access: this episode is VIP-only until this timestamp, then
   * free for everyone. Null (the default) means no gate at all. Settable
   * by whoever can already edit this episode — its own uploading group,
   * or staff — same ownership rule as every other field here, not an
   * admin-only control the way series-level `vipOnly` is.
   */
  earlyAccessUntil: Type.Optional(Type.Union([Type.String({ format: 'date-time' }), Type.Null()])),

  groupId: Type.Optional(Type.Union([Uuid, Type.Null()])),
});
export type EpisodeCreateBody = Static<typeof EpisodeCreateBody>;

export const EpisodeEditBody = Type.Partial(Type.Object({ ...EpisodeCreateBody.properties }));
export type EpisodeEditBody = Static<typeof EpisodeEditBody>;

/**
 * Who a group credits on one episode — "Tłumaczenie: Kasia", "Korekta: Marek",
 * shown under the player. Always the FULL desired set for the submitting
 * group: the server replaces every credit that group previously set on this
 * episode with exactly this list, so a member removed from the form is a
 * member removed from the credit, not something the client has to express
 * as a separate delete call.
 */
export const EpisodeCreditsSetBody = Type.Object({
  credits: Type.Array(
    Type.Object({
      userId: Uuid,
      role: literalUnion(EPISODE_CREDIT_ROLES),
    }),
    { maxItems: 100 },
  ),
  /**
   * Which group is doing the crediting. Null means crediting PlayAnime
   * staff directly with no group attribution — staff-only server-side;
   * a non-staff caller must always pass a real group they belong to.
   */
  groupId: Type.Union([Uuid, Type.Null()]),
});
export type EpisodeCreditsSetBody = Static<typeof EpisodeCreditsSetBody>;

/**
 * Bulk episode creation.
 *
 * A season is added as a range far more often than one episode at a time, and
 * doing it in one transaction avoids leaving a half-populated title behind when
 * the twelfth insert fails.
 */
export const EpisodeBulkCreateBody = Type.Object({
  from: Type.Integer({ minimum: 0, maximum: 10000 }),
  to: Type.Integer({ minimum: 0, maximum: 10000 }),
  durationSeconds: Type.Optional(
    Type.Union([Type.Integer({ minimum: 0, maximum: 86400 }), Type.Null()]),
  ),
  groupId: Type.Optional(Type.Union([Uuid, Type.Null()])),
});
export type EpisodeBulkCreateBody = Static<typeof EpisodeBulkCreateBody>;

export const EpisodeBulkCreateResponse = Type.Object({
  created: Type.Integer({ minimum: 0 }),
  /** Numbers skipped because an episode already existed at that position. */
  skipped: Type.Array(Type.Integer()),
});
export type EpisodeBulkCreateResponse = Static<typeof EpisodeBulkCreateResponse>;

export const EpisodeCreateResponse = Type.Object({ id: Uuid, number: Type.Integer() });
export type EpisodeCreateResponse = Static<typeof EpisodeCreateResponse>;

/* -------------------------------------------------------------------------- */
/* Artwork                                                                     */
/* -------------------------------------------------------------------------- */

export const MediaAssetUpsertBody = Type.Object({
  kind: literalUnion(MEDIA_ASSET_KINDS),
  url: Type.String({ format: 'uri', maxLength: 2048 }),
  isPrimary: Type.Optional(Type.Boolean()),
  locale: Type.Optional(Type.Union([Type.String({ maxLength: 10 }), Type.Null()])),
});
export type MediaAssetUpsertBody = Static<typeof MediaAssetUpsertBody>;

/* -------------------------------------------------------------------------- */
/* Authoring permissions                                                       */
/* -------------------------------------------------------------------------- */

/**
 * What the current user may do in the catalogue.
 *
 * Returned so the UI can render the right controls without duplicating the
 * server's rules. It is a hint for presentation only — every endpoint decides
 * for itself, and a client that ignores this gets a 403.
 */
export const CataloguePermissions = Type.Object({
  /** Create new titles. */
  canCreateAnime: Type.Boolean(),
  /** Edit any title, not only ones the user or their group created. */
  canEditAnyAnime: Type.Boolean(),
  canCreateEpisodes: Type.Boolean(),
  canSubmitSources: Type.Boolean(),
  /**
   * Whether a submitted source goes live immediately. True for staff and for
   * members of a platform-verified group; everyone else's queues for review.
   */
  sourcesPublishImmediately: Type.Boolean(),
  canModerate: Type.Boolean(),
  /** Groups the user may act on behalf of when authoring. */
  groups: Type.Array(
    Type.Object({
      id: Uuid,
      slug: Slug,
      name: Type.String(),
      isVerified: Type.Boolean(),
    }),
  ),
});
export type CataloguePermissions = Static<typeof CataloguePermissions>;

/** Attribution shown on a title or episode in authoring views. */
export const CatalogueAttribution = Type.Object({
  createdByUsername: Type.Union([Type.String(), Type.Null()]),
  createdByGroupName: Type.Union([Type.String(), Type.Null()]),
  createdAt: IsoDateTime,
});
export type CatalogueAttribution = Static<typeof CatalogueAttribution>;

/* -------------------------------------------------------------------------- */
/* Cross-group edit proposals                                                  */
/* -------------------------------------------------------------------------- */

/**
 * What a proposal edits. One shared table backs both — a proposal on an
 * episode is otherwise identical in shape to one on an entry, just with a
 * different `changes` body and target table.
 */
export const CatalogueProposalTargetType = {
  ENTRY: 'entry',
  EPISODE: 'episode',
} as const;
export type CatalogueProposalTargetType =
  (typeof CatalogueProposalTargetType)[keyof typeof CatalogueProposalTargetType];
export const CATALOGUE_PROPOSAL_TARGET_TYPES = Object.values(CatalogueProposalTargetType);

export const CatalogueProposalStatus = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
} as const;
export type CatalogueProposalStatus =
  (typeof CatalogueProposalStatus)[keyof typeof CatalogueProposalStatus];
export const CATALOGUE_PROPOSAL_STATUSES = Object.values(CatalogueProposalStatus);

/**
 * A pending (or decided) cross-group edit.
 *
 * `changes` is the same partial body a direct edit would submit
 * (`EntryEditBody` or `EpisodeEditBody`, depending on `targetType`) — stored
 * as-is and only ever applied through the existing `updateEntry`/`updateEpisode`
 * repository methods at approval time, so a proposal can never bypass any
 * validation a direct edit is subject to.
 */
export const CatalogueEditProposal = Type.Object({
  id: Uuid,
  targetType: literalUnion(CATALOGUE_PROPOSAL_TARGET_TYPES),
  targetId: Uuid,
  /** Denormalized so the queue can render "Series Title — Ep 4" without a join per row. */
  seriesSlug: Slug,
  seriesTitle: Type.String(),
  episodeNumber: Type.Union([Type.Integer(), Type.Null()]),
  proposedByUsername: Type.Union([Type.String(), Type.Null()]),
  proposedByGroupName: Type.Union([Type.String(), Type.Null()]),
  changes: Type.Record(Type.String(), Type.Unknown()),
  status: literalUnion(CATALOGUE_PROPOSAL_STATUSES),
  decidedByUsername: Type.Union([Type.String(), Type.Null()]),
  decidedAt: Type.Union([IsoDateTime, Type.Null()]),
  reason: Type.Union([Type.String(), Type.Null()]),
  createdAt: IsoDateTime,
});
export type CatalogueEditProposal = Static<typeof CatalogueEditProposal>;

export const CatalogueProposalQueue = Type.Object({
  proposals: Type.Array(CatalogueEditProposal),
});
export type CatalogueProposalQueue = Static<typeof CatalogueProposalQueue>;

export const ProposeAnimeEditResponse = Type.Object({
  proposalId: Uuid,
  status: Type.Literal('pending'),
});
export type ProposeAnimeEditResponse = Static<typeof ProposeAnimeEditResponse>;

export const CatalogueProposalDecisionBody = Type.Object({
  approve: Type.Boolean(),
  /** Required on rejection so the proposer knows what to fix; optional on approval. */
  reason: Type.Optional(Type.String({ maxLength: 1000 })),
});
export type CatalogueProposalDecisionBody = Static<typeof CatalogueProposalDecisionBody>;

/* -------------------------------------------------------------------------- */
/* Audit trail                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * One recorded change to a title or one of its episodes.
 *
 * `changes` holds real before/after values for every field the edit touched
 * (see `catalogue.service.ts`'s `diffAnimeEdit`/`diffEpisodeEdit`) — not just
 * the list of field names that changed, which is all the admin module's own
 * separate, older audit write ever recorded.
 */
export const CatalogueAuditEntry = Type.Object({
  id: Uuid,
  action: Type.String(),
  targetType: literalUnion(CATALOGUE_PROPOSAL_TARGET_TYPES),
  targetId: Uuid,
  actorUsername: Type.Union([Type.String(), Type.Null()]),
  reason: Type.Union([Type.String(), Type.Null()]),
  changes: Type.Record(Type.String(), Type.Object({ before: Type.Unknown(), after: Type.Unknown() })),
  createdAt: IsoDateTime,
});
export type CatalogueAuditEntry = Static<typeof CatalogueAuditEntry>;

export const CatalogueAuditTrail = Type.Object({
  entries: Type.Array(CatalogueAuditEntry),
});
export type CatalogueAuditTrail = Static<typeof CatalogueAuditTrail>;
