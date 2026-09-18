import { Type, type Static } from '@sinclair/typebox';
import {
  CursorPageOf,
  CursorQuery,
  ImageRef,
  IsoDateTime,
  literalUnion,
  Slug,
  Uuid,
} from '../common/index.js';
import { AGE_RATINGS, ENTRY_RELATION_TYPES, ENTRY_TYPES, RELEASE_STATUSES, SEASONS_OF_YEAR } from './enums.js';

export * from './enums.js';
export * from './episodes.js';

/** Title set. No localized variant — a title is not translated, unlike the episode content around it. */
export const AnimeTitles = Type.Object({
  romaji: Type.String(),
  english: Type.Union([Type.String(), Type.Null()]),
  native: Type.Union([Type.String(), Type.Null()]),
});
export type AnimeTitles = Static<typeof AnimeTitles>;

export const AnimeGenre = Type.Object({
  slug: Slug,
  name: Type.String(),
});
export type AnimeGenre = Static<typeof AnimeGenre>;
export const GenreListResponse = Type.Array(AnimeGenre);
export type GenreListResponse = Static<typeof GenreListResponse>;

/**
 * A tag — AniList's much larger, free-form counterpart to a genre (Isekai,
 * Time Travel, Reverse Harem, thousands more). Unlike genres, created on
 * demand from AniList's own set rather than hand-curated (see
 * `packages/importer/src/taxonomy.ts`'s `resolveOrCreateTaxonomy`), which
 * is why `category` exists here and not on `AnimeGenre` — AniList groups
 * its own tags into categories (Setting, Cast, Demographic, ...) and this
 * carries that through rather than discarding it.
 */
export const AnimeTag = Type.Object({
  slug: Slug,
  name: Type.String(),
  category: Type.Union([Type.String(), Type.Null()]),
});
export type AnimeTag = Static<typeof AnimeTag>;
export const TagListResponse = Type.Array(AnimeTag);
export type TagListResponse = Static<typeof TagListResponse>;

export const AnimeStudio = Type.Object({
  slug: Slug,
  name: Type.String(),
  isPrimary: Type.Boolean(),
});
export type AnimeStudio = Static<typeof AnimeStudio>;

export const AnimeAsset = Type.Object({
  kind: Type.String(),
  url: Type.String({ format: 'uri' }),
  width: Type.Union([Type.Integer(), Type.Null()]),
  height: Type.Union([Type.Integer(), Type.Null()]),
  blurhash: Type.Union([Type.String(), Type.Null()]),
  locale: Type.Union([Type.String(), Type.Null()]),
  isPrimary: Type.Boolean(),
});
export type AnimeAsset = Static<typeof AnimeAsset>;

/**
 * One release within a series — a season, a cour, a movie, an OVA, a
 * special. Carries what a season-selector row or an "Extras" list item
 * renders; the full field set (synopsis, dates, studios/tags) lives on
 * `EntryDetailDto`, fetched only when that one entry is opened.
 */
export const EntrySummaryDto = Type.Object({
  id: Uuid,
  slug: Slug,
  entryType: literalUnion(ENTRY_TYPES),
  titles: AnimeTitles,
  seasonNumber: Type.Union([Type.Integer(), Type.Null()]),
  courNumber: Type.Union([Type.Integer(), Type.Null()]),
  airingSeason: Type.Union([literalUnion(SEASONS_OF_YEAR), Type.Null()]),
  airingYear: Type.Union([Type.Integer(), Type.Null()]),
  status: literalUnion(RELEASE_STATUSES),
  episodeCount: Type.Union([Type.Integer(), Type.Null()]),
  poster: Type.Union([ImageRef, Type.Null()]),
  releaseOrder: Type.Union([Type.Integer(), Type.Null()]),
  chronologicalOrder: Type.Union([Type.Integer(), Type.Null()]),
  isMainEntry: Type.Boolean(),
});
export type EntrySummaryDto = Static<typeof EntrySummaryDto>;

export const EntryDetailDto = Type.Object({
  ...EntrySummaryDto.properties,
  seriesId: Uuid,
  synopsis: Type.Union([Type.String(), Type.Null()]),
  ageRating: Type.Union([literalUnion(AGE_RATINGS), Type.Null()]),
  durationMinutes: Type.Union([Type.Integer(), Type.Null()]),
  startDate: Type.Union([Type.String({ format: 'date' }), Type.Null()]),
  endDate: Type.Union([Type.String({ format: 'date' }), Type.Null()]),
  banner: Type.Union([ImageRef, Type.Null()]),
  assets: Type.Array(AnimeAsset),
  studios: Type.Array(AnimeStudio),
  genres: Type.Array(AnimeGenre),
  tags: Type.Array(AnimeTag),
  isAdult: Type.Boolean(),
  updatedAt: IsoDateTime,
  createdByGroupId: Type.Union([Uuid, Type.Null()]),
  anilistId: Type.Union([Type.Integer(), Type.Null()]),
});
export type EntryDetailDto = Static<typeof EntryDetailDto>;

/**
 * Catalogue card — one series. Deliberately small: a listing of 24 of
 * these is the single hottest response in the product, so it carries
 * only what a card renders, drawn from the series' default (main) entry.
 */
export const SeriesSummaryDto = Type.Object({
  id: Uuid,
  slug: Slug,
  title: Type.String(),
  /** The default entry's own release info — what a browse-grid card shows before any entry is picked. */
  format: Type.Union([literalUnion(ENTRY_TYPES), Type.Null()]),
  status: Type.Union([literalUnion(RELEASE_STATUSES), Type.Null()]),
  seasonYear: Type.Union([Type.Integer(), Type.Null()]),
  season: Type.Union([literalUnion(SEASONS_OF_YEAR), Type.Null()]),
  episodeCount: Type.Union([Type.Integer(), Type.Null()]),
  averageRating: Type.Union([Type.Number({ minimum: 0, maximum: 10 }), Type.Null()]),
  poster: Type.Union([ImageRef, Type.Null()]),
  genres: Type.Array(AnimeGenre),
});
export type SeriesSummaryDto = Static<typeof SeriesSummaryDto>;

/** Full detail view. Adds everything a series page needs, including every one of its entries. */
export const SeriesDetailDto = Type.Object({
  ...SeriesSummaryDto.properties,
  synopsis: Type.Union([Type.String(), Type.Null()]),
  banner: Type.Union([ImageRef, Type.Null()]),
  franchiseId: Type.Union([Uuid, Type.Null()]),
  ratingCount: Type.Integer(),
  isAdult: Type.Boolean(),
  updatedAt: IsoDateTime,
  /**
   * Every release under this series, in `releaseOrder` (falling back to
   * date) — the season/extras breakdown, returned in the same response
   * so the detail page never needs a second round trip per entry.
   */
  entries: Type.Array(EntrySummaryDto),
});
export type SeriesDetailDto = Static<typeof SeriesDetailDto>;

export const AnimePage = CursorPageOf(SeriesSummaryDto);
export type AnimePage = Static<typeof AnimePage>;

/** Sort orders the catalogue listing supports. Each is index-backed. */
export const AnimeSort = {
  POPULARITY: 'popularity',
  RATING: 'rating',
  NEWEST: 'newest',
  TITLE: 'title',
} as const;
export type AnimeSort = (typeof AnimeSort)[keyof typeof AnimeSort];
export const ANIME_SORTS = Object.values(AnimeSort);

/**
 * Declared as a flat object rather than `Type.Composite([CursorQuery, ...])`.
 *
 * Composite erases literal unions from its members, so every enum-valued field
 * degrades to `string` in the inferred type and Elysia then infers the handler
 * return as `never`. Spreading the properties keeps the static types intact and
 * produces the identical JSON Schema.
 */
export const AnimeListQuery = Type.Object({
  ...CursorQuery.properties,
  search: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
  genre: Type.Optional(Slug),
  tag: Type.Optional(Slug),
  /** Entry type, e.g. filtering to just movies or just TV seasons — separate from `season`/`seasonYear` below, which is broadcast timing. */
  entryType: Type.Optional(literalUnion(ENTRY_TYPES)),
  status: Type.Optional(literalUnion(RELEASE_STATUSES)),
  season: Type.Optional(literalUnion(SEASONS_OF_YEAR)),
  seasonYear: Type.Optional(Type.Integer({ minimum: 1900, maximum: 2200 })),
  sort: Type.Optional(literalUnion(ANIME_SORTS)),
});
export type AnimeListQuery = Static<typeof AnimeListQuery>;

export const AnimeSlugParams = Type.Object({ slug: Slug });
export type AnimeSlugParams = Static<typeof AnimeSlugParams>;

export const EntryIdParams = Type.Object({ entryId: Uuid });
export type EntryIdParams = Static<typeof EntryIdParams>;

/** A relation edge as read from one entry's point of view. */
export const EntryRelationDto = Type.Object({
  id: Uuid,
  direction: Type.Union([Type.Literal('from'), Type.Literal('to')]),
  relationType: literalUnion(ENTRY_RELATION_TYPES),
  source: Type.Union([Type.Literal('anilist'), Type.Literal('manual')]),
  entry: EntrySummaryDto,
});
export type EntryRelationDto = Static<typeof EntryRelationDto>;

/** One node in a series' resolved timeline — an entry plus its position in release/chronological order. */
export const TimelineEntryDto = Type.Object({
  entry: EntrySummaryDto,
  relationToNext: Type.Union([literalUnion(ENTRY_RELATION_TYPES), Type.Null()]),
});
export type TimelineEntryDto = Static<typeof TimelineEntryDto>;

export const SeriesTimelineDto = Type.Object({
  seriesId: Uuid,
  /** Ordered by `releaseOrder`, falling back to date — never fabricated when both are unknown. */
  byReleaseOrder: Type.Array(TimelineEntryDto),
  /** Only entries with a known `chronologicalOrder` — omits rather than guesses. */
  byChronologicalOrder: Type.Array(TimelineEntryDto),
});
export type SeriesTimelineDto = Static<typeof SeriesTimelineDto>;
