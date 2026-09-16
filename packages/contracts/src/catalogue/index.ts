import { Type, type Static } from '@sinclair/typebox';
import { IsoDateTime, Slug, Uuid, literalUnion } from '../common/index.js';
import {
  AGE_RATINGS,
  MEDIA_ASSET_KINDS,
  RELEASE_STATUSES,
  SEASONS_OF_YEAR,
  TITLE_FORMATS,
} from '../anime/enums.js';

/**
 * Catalogue authoring.
 *
 * Creating a title is not the same kind of act as submitting a source. A source
 * points at one episode and can be disabled without trace; a title is global,
 * its slug is permanent, and every library entry and rating hangs off it. These
 * schemas are therefore stricter about what must be supplied up front, and the
 * server records who created each row.
 */

/* -------------------------------------------------------------------------- */
/* Titles                                                                      */
/* -------------------------------------------------------------------------- */

export const AnimeCreateBody = Type.Object({
  /**
   * Canonical romaji title. Required because it is the one title every query
   * can rely on and the one the slug is derived from.
   */
  titleRomaji: Type.String({ minLength: 1, maxLength: 255 }),
  titleEnglish: Type.Optional(Type.Union([Type.String({ maxLength: 255 }), Type.Null()])),
  titleNative: Type.Optional(Type.Union([Type.String({ maxLength: 255 }), Type.Null()])),

  synopsis: Type.Optional(Type.Union([Type.String({ maxLength: 10000 }), Type.Null()])),

  format: literalUnion(TITLE_FORMATS),
  status: Type.Optional(literalUnion(RELEASE_STATUSES)),

  season: Type.Optional(Type.Union([literalUnion(SEASONS_OF_YEAR), Type.Null()])),
  seasonYear: Type.Optional(
    Type.Union([Type.Integer({ minimum: 1900, maximum: 2200 }), Type.Null()]),
  ),

  startDate: Type.Optional(Type.Union([Type.String({ format: 'date' }), Type.Null()])),
  endDate: Type.Optional(Type.Union([Type.String({ format: 'date' }), Type.Null()])),

  episodeCount: Type.Optional(Type.Union([Type.Integer({ minimum: 0, maximum: 10000 }), Type.Null()])),
  durationMinutes: Type.Optional(Type.Union([Type.Integer({ minimum: 0, maximum: 1000 }), Type.Null()])),

  ageRating: Type.Optional(Type.Union([literalUnion(AGE_RATINGS), Type.Null()])),
  /** Gates the title behind the viewer's mature-content preference. */
  isAdult: Type.Optional(Type.Boolean()),

  /** Genre slugs. Unknown slugs are rejected rather than silently dropped. */
  genres: Type.Optional(Type.Array(Slug, { maxItems: 20 })),
  /** Studio names. Created on demand if not already known. */
  studios: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 200 }), { maxItems: 10 })),

  posterUrl: Type.Optional(Type.Union([Type.String({ format: 'uri', maxLength: 2048 }), Type.Null()])),
  bannerUrl: Type.Optional(Type.Union([Type.String({ format: 'uri', maxLength: 2048 }), Type.Null()])),

  /**
   * Group to credit for adding this title. The caller must be a member; the
   * server verifies that rather than trusting the id.
   */
  groupId: Type.Optional(Type.Union([Uuid, Type.Null()])),
});
export type AnimeCreateBody = Static<typeof AnimeCreateBody>;

/**
 * Title edits.
 *
 * `titleRomaji` is editable — a typo in the canonical title should be fixable —
 * but the slug is not, and is never recomputed from it. Changing a slug breaks
 * every existing link and is a moderator action performed deliberately.
 */
export const AnimeEditBody = Type.Partial(
  Type.Object({
    ...AnimeCreateBody.properties,
  }),
);
export type AnimeEditBody = Static<typeof AnimeEditBody>;

/**
 * A title that may be a duplicate of what is being created.
 *
 * Returned as a warning, not an error: two genuinely different works can share
 * a title, and refusing outright would make legitimate entries impossible.
 */
export const DuplicateTitleWarning = Type.Object({
  id: Uuid,
  slug: Slug,
  title: Type.String(),
  format: literalUnion(TITLE_FORMATS),
  seasonYear: Type.Union([Type.Integer(), Type.Null()]),
  /** 0-1. How closely the titles match, by trigram similarity. */
  similarity: Type.Number({ minimum: 0, maximum: 1 }),
});
export type DuplicateTitleWarning = Static<typeof DuplicateTitleWarning>;

export const DuplicateCheckResponse = Type.Object({
  matches: Type.Array(DuplicateTitleWarning),
});
export type DuplicateCheckResponse = Static<typeof DuplicateCheckResponse>;

export const AnimeCreateResponse = Type.Object({
  id: Uuid,
  slug: Slug,
});
export type AnimeCreateResponse = Static<typeof AnimeCreateResponse>;

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

  groupId: Type.Optional(Type.Union([Uuid, Type.Null()])),
});
export type EpisodeCreateBody = Static<typeof EpisodeCreateBody>;

export const EpisodeEditBody = Type.Partial(Type.Object({ ...EpisodeCreateBody.properties }));
export type EpisodeEditBody = Static<typeof EpisodeEditBody>;

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
