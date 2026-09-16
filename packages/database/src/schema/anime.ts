import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  integer,
  numeric,
  pgTable,
  smallint,
  text,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import {
  ageRatingEnum,
  deletedAt,
  fk,
  mediaAssetKindEnum,
  organizationRoleEnum,
  primaryId,
  releaseStatusEnum,
  seasonOfYearEnum,
  timestamps,
  titleFormatEnum,
  titleKindEnum,
} from './_shared.js';
import { users } from './users.js';

/**
 * Anime catalogue.
 *
 * The model is deliberately not `Anime -> Episode`. Franchises are messy:
 * `Fate` has TV series, films, and spin-offs that share characters but no
 * season ordering; `Monogatari` has a broadcast order distinct from its
 * chronological order; a single "season" may be split into two cours with
 * different opening themes and a mid-year gap.
 *
 * The shape used here:
 *
 *   franchise   an umbrella brand ("Fate", "Monogatari")
 *     └── anime a releasable work: one TV series, one film, one OVA
 *           └── season   a numbered run within that work
 *                 └── cour   a broadcast block within a season
 *           └── episode
 *
 * `anime` is the unit users actually rate, list, and discuss, so it is the
 * centre of the model. `franchise` exists so related works can be grouped
 * without pretending they are seasons of one another. `season` and `cour` are
 * nullable layers — a film needs neither.
 */
export const franchises = pgTable(
  'franchises',
  {
    id: primaryId(),
    slug: varchar('slug', { length: 96 }).notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description'),
    ...timestamps(),
  },
  (table) => [uniqueIndex('franchises_slug_key').on(table.slug)],
);

/** A releasable work. The unit of rating, listing, and discussion. */
export const anime = pgTable(
  'anime',
  {
    id: primaryId(),

    franchiseId: fk('franchise_id').references(() => franchises.id, { onDelete: 'set null' }),

    slug: varchar('slug', { length: 96 }).notNull(),

    /**
     * Canonical romaji title, always present. Localized and alternate titles
     * live in `anime_titles`; this column exists so every query has a title
     * without a join, and so sorting by title needs no subquery.
     */
    titleRomaji: varchar('title_romaji', { length: 255 }).notNull(),
    titleEnglish: varchar('title_english', { length: 255 }),
    titleNative: varchar('title_native', { length: 255 }),
    titlePolish: varchar('title_polish', { length: 255 }),

    synopsis: text('synopsis'),

    format: titleFormatEnum('format').notNull(),
    status: releaseStatusEnum('status').notNull().default('not_yet_released'),

    /** Broadcast season. Indexed together for the seasonal calendar. */
    season: seasonOfYearEnum('season'),
    seasonYear: smallint('season_year'),

    startDate: date('start_date'),
    endDate: date('end_date'),

    /** Planned episode count; null while unannounced. */
    episodeCount: smallint('episode_count'),
    /** Typical runtime, for the "time to complete" estimate. */
    durationMinutes: smallint('duration_minutes'),

    ageRating: ageRatingEnum('age_rating'),
    /** Gates the title behind the mature-content preference. */
    isAdult: boolean('is_adult').notNull().default(false),

    /**
     * Cached aggregate of `ratings`. numeric(4,2) holds 0.00-10.00 exactly
     * (precision 3 overflows on a 10.00 average — a single 10/10 rating hits
     * this); a float would make "8.10" render as "8.099999".
     */
    averageRating: numeric('average_rating', { precision: 4, scale: 2 }),
    ratingCount: integer('rating_count').notNull().default(0),

    /** Denormalized popularity, recomputed periodically. Drives default sort. */
    popularityScore: integer('popularity_score').notNull().default(0),
    memberCount: integer('member_count').notNull().default(0),

    /**
     * Who added this title, and on behalf of which group.
     *
     * Titles are global and their slugs are permanent, so a bad entry is
     * lasting damage to the catalogue. Attribution makes that damage traceable
     * and gives moderators someone to talk to — which is what makes it safe to
     * let translator groups create titles directly rather than through a queue.
     *
     * Null for seeded and imported rows, which have no submitter.
     */
    createdByUserId: fk('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    /**
     * Deliberately without a foreign key: `translators.ts` imports this file,
     * so referencing `translator_groups` here would create an import cycle
     * between the two schema modules. The constraint is added in the migration
     * instead, where no module ordering applies.
     */
    createdByGroupId: fk('created_by_group_id'),

    ...timestamps(),
    deletedAt: deletedAt(),
  },
  (table) => [
    uniqueIndex('anime_slug_key').on(table.slug),
    // "What has this group added?" — the moderation view when a group's
    // catalogue entries need reviewing together.
    index('anime_created_by_group_idx').on(table.createdByGroupId),

    // The seasonal calendar: "what aired in fall 2025".
    index('anime_season_idx')
      .on(table.seasonYear, table.season)
      .where(sql`${table.deletedAt} is null`),

    // Default catalogue sort. Descending, matching how it is queried.
    index('anime_popularity_idx')
      .on(sql`${table.popularityScore} desc`)
      .where(sql`${table.deletedAt} is null`),

    // "Highest rated", excluding titles with too few ratings to be meaningful.
    index('anime_rating_idx')
      .on(sql`${table.averageRating} desc nulls last`)
      .where(sql`${table.deletedAt} is null and ${table.ratingCount} >= 10`),

    index('anime_status_idx').on(table.status).where(sql`${table.deletedAt} is null`),
    index('anime_franchise_idx').on(table.franchiseId),

    // Trigram index for fuzzy title search. Requires pg_trgm, enabled in the
    // init script; a plain b-tree cannot serve `ILIKE '%naruto%'`.
    index('anime_title_trgm_idx').using('gin', sql`${table.titleRomaji} gin_trgm_ops`),
  ],
);

/**
 * Alternate and localized titles.
 *
 * Separate from `anime` because the count is unbounded: synonyms, regional
 * titles, and abbreviations users actually search for ("FMAB", "SnK").
 */
export const animeTitles = pgTable(
  'anime_titles',
  {
    id: primaryId(),
    animeId: fk('anime_id')
      .references(() => anime.id, { onDelete: 'cascade' })
      .notNull(),

    kind: titleKindEnum('kind').notNull(),
    title: varchar('title', { length: 255 }).notNull(),
    /** BCP-47 tag when the title is locale-specific. */
    locale: varchar('locale', { length: 10 }),

    ...timestamps(),
  },
  (table) => [
    uniqueIndex('anime_titles_unique').on(table.animeId, table.kind, table.title),
    index('anime_titles_search_idx').using('gin', sql`${table.title} gin_trgm_ops`),
  ],
);

/**
 * A numbered run within a work.
 *
 * Nullable layer: a film has no season. Where a work does have seasons, this is
 * what lets episode numbering restart at 1 without ambiguity.
 */
export const seasons = pgTable(
  'seasons',
  {
    id: primaryId(),
    animeId: fk('anime_id')
      .references(() => anime.id, { onDelete: 'cascade' })
      .notNull(),

    number: smallint('number').notNull(),
    title: varchar('title', { length: 255 }),

    startDate: date('start_date'),
    endDate: date('end_date'),

    ...timestamps(),
  },
  (table) => [uniqueIndex('seasons_anime_number_key').on(table.animeId, table.number)],
);

/**
 * A broadcast block within a season.
 *
 * A "split cour" airs part of a season, breaks for a quarter, then resumes.
 * Modelling it explicitly is what allows the calendar to show the gap instead
 * of claiming a season ran continuously for six months.
 */
export const cours = pgTable(
  'cours',
  {
    id: primaryId(),
    seasonId: fk('season_id')
      .references(() => seasons.id, { onDelete: 'cascade' })
      .notNull(),

    number: smallint('number').notNull(),
    season: seasonOfYearEnum('season'),
    seasonYear: smallint('season_year'),

    startDate: date('start_date'),
    endDate: date('end_date'),

    ...timestamps(),
  },
  (table) => [uniqueIndex('cours_season_number_key').on(table.seasonId, table.number)],
);

export const episodes = pgTable(
  'episodes',
  {
    id: primaryId(),
    animeId: fk('anime_id')
      .references(() => anime.id, { onDelete: 'cascade' })
      .notNull(),
    seasonId: fk('season_id').references(() => seasons.id, { onDelete: 'set null' }),
    courId: fk('cour_id').references(() => cours.id, { onDelete: 'set null' }),

    /** Number within the season; restarts per season. */
    number: smallint('number').notNull(),
    /** Continuous number across the whole work, for "episode 87 of 220". */
    absoluteNumber: smallint('absolute_number'),

    title: varchar('title', { length: 255 }),
    titlePolish: varchar('title_polish', { length: 255 }),
    synopsis: text('synopsis'),

    airedAt: date('aired_at'),
    durationSeconds: integer('duration_seconds'),

    /**
     * Intro and outro ranges, for skip buttons. Null means unknown — the player
     * hides the control rather than guessing.
     */
    introStartSeconds: integer('intro_start_seconds'),
    introEndSeconds: integer('intro_end_seconds'),
    outroStartSeconds: integer('outro_start_seconds'),

    isFiller: boolean('is_filler').notNull().default(false),
    isRecap: boolean('is_recap').notNull().default(false),

    /** Who added this episode. See the note on `anime.created_by_user_id`. */
    createdByUserId: fk('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdByGroupId: fk('created_by_group_id'),

    ...timestamps(),
    deletedAt: deletedAt(),
  },
  (table) => [
    // An anime cannot have two episode 3s in the same season.
    uniqueIndex('episodes_anime_season_number_key').on(table.animeId, table.seasonId, table.number),
    // The episode list for a title page, in order.
    index('episodes_anime_number_idx').on(table.animeId, table.number),
    // The "airing today" calendar query.
    index('episodes_aired_at_idx').on(table.airedAt).where(sql`${table.deletedAt} is null`),
  ],
);

/* -------------------------------------------------------------------------- */
/* Taxonomy                                                                    */
/* -------------------------------------------------------------------------- */

export const genres = pgTable(
  'genres',
  {
    id: primaryId(),
    slug: varchar('slug', { length: 64 }).notNull(),
    name: varchar('name', { length: 64 }).notNull(),
    namePolish: varchar('name_polish', { length: 64 }),
    /** Distinguishes broad genres from narrower descriptive tags. */
    isMature: boolean('is_mature').notNull().default(false),
    ...timestamps(),
  },
  (table) => [uniqueIndex('genres_slug_key').on(table.slug)],
);

export const animeGenres = pgTable(
  'anime_genres',
  {
    animeId: fk('anime_id')
      .references(() => anime.id, { onDelete: 'cascade' })
      .notNull(),
    genreId: fk('genre_id')
      .references(() => genres.id, { onDelete: 'cascade' })
      .notNull(),
  },
  (table) => [
    uniqueIndex('anime_genres_pkey').on(table.animeId, table.genreId),
    // Reverse lookup: "all anime in this genre".
    index('anime_genres_genre_idx').on(table.genreId),
  ],
);

/** Studios, producers, and licensors share one table with a role on the link. */
export const organizations = pgTable(
  'organizations',
  {
    id: primaryId(),
    slug: varchar('slug', { length: 96 }).notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    ...timestamps(),
  },
  (table) => [uniqueIndex('organizations_slug_key').on(table.slug)],
);

export const animeOrganizations = pgTable(
  'anime_organizations',
  {
    animeId: fk('anime_id')
      .references(() => anime.id, { onDelete: 'cascade' })
      .notNull(),
    organizationId: fk('organization_id')
      .references(() => organizations.id, { onDelete: 'cascade' })
      .notNull(),
    role: organizationRoleEnum('role').notNull(),
    /** The lead studio, shown on the card. */
    isPrimary: boolean('is_primary').notNull().default(false),
  },
  (table) => [
    uniqueIndex('anime_organizations_pkey').on(table.animeId, table.organizationId, table.role),
    index('anime_organizations_org_idx').on(table.organizationId),
  ],
);

/**
 * Artwork and trailers.
 *
 * One table for every asset kind, discriminated by `kind`, because they share
 * dimensions, a blurhash, and a language. Separate poster/banner/logo tables
 * would triple the schema for no gain.
 */
export const mediaAssets = pgTable(
  'media_assets',
  {
    id: primaryId(),
    animeId: fk('anime_id').references(() => anime.id, { onDelete: 'cascade' }),
    episodeId: fk('episode_id').references(() => episodes.id, { onDelete: 'cascade' }),

    kind: mediaAssetKindEnum('kind').notNull(),
    url: text('url').notNull(),

    width: smallint('width'),
    height: smallint('height'),
    /** Blurhash placeholder, so cards do not flash while artwork loads. */
    blurhash: varchar('blurhash', { length: 64 }),

    /** Language of a localized poster or a subtitled trailer. */
    locale: varchar('locale', { length: 10 }),
    /** The default asset of this kind for this title. */
    isPrimary: boolean('is_primary').notNull().default(false),

    ...timestamps(),
  },
  (table) => [
    index('media_assets_anime_kind_idx').on(table.animeId, table.kind),
    index('media_assets_episode_kind_idx').on(table.episodeId, table.kind),
    // Exactly one primary asset per kind per title.
    uniqueIndex('media_assets_primary_key')
      .on(table.animeId, table.kind)
      .where(sql`${table.isPrimary} = true and ${table.animeId} is not null`),
  ],
);

/* -------------------------------------------------------------------------- */
/* Relations                                                                   */
/* -------------------------------------------------------------------------- */

export const franchisesRelations = relations(franchises, ({ many }) => ({
  works: many(anime),
}));

export const animeRelations = relations(anime, ({ one, many }) => ({
  franchise: one(franchises, { fields: [anime.franchiseId], references: [franchises.id] }),
  titles: many(animeTitles),
  seasons: many(seasons),
  episodes: many(episodes),
  genres: many(animeGenres),
  organizations: many(animeOrganizations),
  assets: many(mediaAssets),
}));

export const seasonsRelations = relations(seasons, ({ one, many }) => ({
  anime: one(anime, { fields: [seasons.animeId], references: [anime.id] }),
  cours: many(cours),
  episodes: many(episodes),
}));

export const coursRelations = relations(cours, ({ one, many }) => ({
  season: one(seasons, { fields: [cours.seasonId], references: [seasons.id] }),
  episodes: many(episodes),
}));

export const episodesRelations = relations(episodes, ({ one }) => ({
  anime: one(anime, { fields: [episodes.animeId], references: [anime.id] }),
  season: one(seasons, { fields: [episodes.seasonId], references: [seasons.id] }),
  cour: one(cours, { fields: [episodes.courId], references: [cours.id] }),
}));

export const animeGenresRelations = relations(animeGenres, ({ one }) => ({
  anime: one(anime, { fields: [animeGenres.animeId], references: [anime.id] }),
  genre: one(genres, { fields: [animeGenres.genreId], references: [genres.id] }),
}));

export const animeOrganizationsRelations = relations(animeOrganizations, ({ one }) => ({
  anime: one(anime, { fields: [animeOrganizations.animeId], references: [anime.id] }),
  organization: one(organizations, {
    fields: [animeOrganizations.organizationId],
    references: [organizations.id],
  }),
}));

export const mediaAssetsRelations = relations(mediaAssets, ({ one }) => ({
  anime: one(anime, { fields: [mediaAssets.animeId], references: [anime.id] }),
  episode: one(episodes, { fields: [mediaAssets.episodeId], references: [episodes.id] }),
}));

export type AnimeRow = typeof anime.$inferSelect;
export type NewAnimeRow = typeof anime.$inferInsert;
export type EpisodeRow = typeof episodes.$inferSelect;
export type GenreRow = typeof genres.$inferSelect;
export type MediaAssetRow = typeof mediaAssets.$inferSelect;
