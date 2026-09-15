import { Type, type Static } from '@sinclair/typebox';
import { CursorPageOf, CursorQuery, ImageRef, IsoDateTime, literalUnion, Slug, Uuid } from '../common/index.js';
import {
  AGE_RATINGS,
  RELEASE_STATUSES,
  SEASONS_OF_YEAR,
  TITLE_FORMATS,
} from './enums.js';

export * from './enums.js';

/** Localized title set, resolved for the requesting locale. */
export const AnimeTitles = Type.Object({
  romaji: Type.String(),
  english: Type.Union([Type.String(), Type.Null()]),
  native: Type.Union([Type.String(), Type.Null()]),
  polish: Type.Union([Type.String(), Type.Null()]),
});
export type AnimeTitles = Static<typeof AnimeTitles>;

export const AnimeGenre = Type.Object({
  slug: Slug,
  name: Type.String(),
});
export type AnimeGenre = Static<typeof AnimeGenre>;

export const AnimeStudio = Type.Object({
  slug: Slug,
  name: Type.String(),
  isPrimary: Type.Boolean(),
});
export type AnimeStudio = Static<typeof AnimeStudio>;

/**
 * Catalogue card. Deliberately small: a listing of 24 of these is the single
 * hottest response in the product, so it carries only what a card renders.
 */
export const AnimeSummary = Type.Object({
  id: Uuid,
  slug: Slug,
  titles: AnimeTitles,
  format: literalUnion(TITLE_FORMATS),
  status: literalUnion(RELEASE_STATUSES),
  seasonYear: Type.Union([Type.Integer(), Type.Null()]),
  season: Type.Union([literalUnion(SEASONS_OF_YEAR), Type.Null()]),
  episodeCount: Type.Union([Type.Integer(), Type.Null()]),
  averageRating: Type.Union([Type.Number({ minimum: 0, maximum: 10 }), Type.Null()]),
  poster: Type.Union([ImageRef, Type.Null()]),
  genres: Type.Array(AnimeGenre),
});
export type AnimeSummary = Static<typeof AnimeSummary>;

/** Full detail view. Adds everything a title page needs and a card does not. */
export const AnimeDetail = Type.Object({
  ...AnimeSummary.properties,
  synopsis: Type.Union([Type.String(), Type.Null()]),
  ageRating: Type.Union([literalUnion(AGE_RATINGS), Type.Null()]),
  durationMinutes: Type.Union([Type.Integer(), Type.Null()]),
  startDate: Type.Union([Type.String({ format: 'date' }), Type.Null()]),
  endDate: Type.Union([Type.String({ format: 'date' }), Type.Null()]),
  banner: Type.Union([ImageRef, Type.Null()]),
  studios: Type.Array(AnimeStudio),
  ratingCount: Type.Integer(),
  isAdult: Type.Boolean(),
  updatedAt: IsoDateTime,
});
export type AnimeDetail = Static<typeof AnimeDetail>;

export const AnimePage = CursorPageOf(AnimeSummary);
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
  format: Type.Optional(literalUnion(TITLE_FORMATS)),
  status: Type.Optional(literalUnion(RELEASE_STATUSES)),
  season: Type.Optional(literalUnion(SEASONS_OF_YEAR)),
  seasonYear: Type.Optional(Type.Integer({ minimum: 1900, maximum: 2200 })),
  sort: Type.Optional(literalUnion(ANIME_SORTS)),
});
export type AnimeListQuery = Static<typeof AnimeListQuery>;

export const AnimeSlugParams = Type.Object({ slug: Slug });
export type AnimeSlugParams = Static<typeof AnimeSlugParams>;
