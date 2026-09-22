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
  entryRelationSourceEnum,
  entryRelationTypeEnum,
  entryTypeEnum,
  episodeTypeEnum,
  fk,
  mediaAssetKindEnum,
  organizationRoleEnum,
  primaryId,
  releaseStatusEnum,
  seasonOfYearEnum,
  timestamps,
  titleKindEnum,
} from './_shared.js';
import { users } from './users.js';

/**
 * Anime catalogue.
 *
 * The model is `Franchise -> Series -> Entry -> Episode`. A franchise is
 * messy in ways a flat `Anime -> Episode` model cannot represent: `Fate`
 * has TV series, films, and spin-offs that share characters but no season
 * ordering; a series can split a season into two cours; a TV run, its OVA,
 * and its movie sequel form a release order that is not the same as their
 * chronological (in-universe) order.
 *
 *   franchise    an umbrella brand ("Fate", "Monogatari") — optional
 *     └── series the thing a user actually rates, lists, and discusses
 *           └── entry    one watchable release: a TV season, a cour, a
 *                         film, an OVA, a special — has its own AniList
 *                         id, its own title, its own art
 *                 └── episode
 *
 * `series` is deliberately thin (title, synopsis, art, aggregate rating) —
 * everything AniList actually maps to (format, dates, episode count,
 * status, genres/tags/studios) lives on `entries`, because that metadata
 * genuinely differs between "Season 1" and "Season 2" of the same series.
 * A cour is not a fifth hierarchy level: `entries.seasonNumber` +
 * `entries.courNumber` on two sibling rows (same season number, different
 * cour number) represents a split cour, matching how AniList itself
 * represents one (two separate `Media` objects).
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

/**
 * A logical series — the unit of rating, library membership, and
 * discussion. "Attack on Titan" is one `series` row; its three TV seasons,
 * its OVA, and its compilation movies are each a separate `entries` row
 * underneath it.
 */
export const series = pgTable(
  'series',
  {
    id: primaryId(),

    franchiseId: fk('franchise_id').references(() => franchises.id, { onDelete: 'set null' }),

    slug: varchar('slug', { length: 96 }).notNull(),

    /** The name users search for and pick — not any one Entry's own title. */
    title: varchar('title', { length: 255 }).notNull(),
    /** A series-level blurb, independent of any one Entry's AniList synopsis. Optional — most series have none of their own. */
    synopsis: text('synopsis'),

    /** The series' own default art, shown on browse/search cards — distinct from any one Entry's own poster/banner. */
    posterUrl: text('poster_url'),
    bannerUrl: text('banner_url'),

    /**
     * Cached aggregate of `ratings`, which now key off `series`, not
     * `entries` — a user rates "Attack on Titan," not "Attack on Titan
     * Season 2" specifically. numeric(4,2) holds 0.00-10.00 exactly.
     *
     * Exclusively PlayAnime's own users' ratings — recomputed only by
     * `EngagementRepository.refreshRatingAggregate`, from real `ratings`
     * rows. `anilistScore` below is the separate, external number; the two
     * used to collide in this one column (an AniList sync wrote its score
     * here, then any real user rating silently overwrote it, and vice
     * versa on the next sync — whichever ran last won, destroying the
     * other). See `anilistScore`'s own doc comment.
     */
    averageRating: numeric('average_rating', { precision: 4, scale: 2 }),
    ratingCount: integer('rating_count').notNull().default(0),

    /**
     * AniList's own `averageScore` (0-100), converted to this app's 0.00-
     * 10.00 scale by the same `mapAverageRating` the importer already used
     * — kept as an entirely separate signal from `averageRating` (real
     * PlayAnime user ratings), never merged into one number. Refreshed
     * only by an AniList sync; untouched by anything rating-related on
     * this app's own side. Null for a series with no linked AniList entry,
     * or one AniList itself reports no score for yet.
     */
    anilistScore: numeric('anilist_score', { precision: 4, scale: 2 }),

    /** Denormalized popularity, recomputed periodically. Drives default sort. */
    popularityScore: integer('popularity_score').notNull().default(0),
    memberCount: integer('member_count').notNull().default(0),

    ...timestamps(),
    deletedAt: deletedAt(),
  },
  (table) => [
    uniqueIndex('series_slug_key').on(table.slug),
    index('series_franchise_idx').on(table.franchiseId),
    index('series_popularity_idx')
      .on(sql`${table.popularityScore} desc`)
      .where(sql`${table.deletedAt} is null`),
    index('series_rating_idx')
      .on(sql`${table.averageRating} desc nulls last`)
      .where(sql`${table.deletedAt} is null and ${table.ratingCount} >= 10`),
    // Trigram index for fuzzy title search. Requires pg_trgm, enabled in the
    // init script; a plain b-tree cannot serve `ILIKE '%naruto%'`.
    index('series_title_trgm_idx').using('gin', sql`${table.title} gin_trgm_ops`),
  ],
);

/**
 * One watchable release within a series: a TV season, a cour, a film, an
 * OVA, an ONA, a special, a recap, or a compilation. The unit AniList
 * metadata (format, dates, episode count, genres/tags/studios) actually
 * maps to — a season and its OVA are different AniList `Media` objects with
 * different everything except which series they belong to.
 */
export const entries = pgTable(
  'entries',
  {
    id: primaryId(),

    seriesId: fk('series_id')
      .references(() => series.id, { onDelete: 'cascade' })
      .notNull(),

    /** Unique within its series, not globally — the Entry-scoped part of `/anime/:seriesSlug/:entrySlug`. */
    slug: varchar('slug', { length: 96 }).notNull(),

    entryType: entryTypeEnum('entry_type').notNull(),

    /**
     * An Entry keeps its own titles — "Season 2" or "No Regrets" is a
     * different string from the Series' own title. Localized/alternate
     * titles live in `entry_titles`.
     */
    titleRomaji: varchar('title_romaji', { length: 255 }).notNull(),
    titleEnglish: varchar('title_english', { length: 255 }),
    titleNative: varchar('title_native', { length: 255 }),

    /** An Entry's own AniList-sourced synopsis — distinct from `series.synopsis`, which is curated/independent. */
    synopsis: text('synopsis'),

    status: releaseStatusEnum('status').notNull().default('not_yet_released'),

    /**
     * Series-internal sequence — "Season 2" -> 2. Null for a movie, OVA,
     * or special: never force a numeric season onto a release that has
     * none. `courNumber` only means something alongside a `seasonNumber`
     * (enforced by a check constraint in the migration — Drizzle's
     * pg-core has no first-class CHECK builder, so it's added as raw SQL
     * there rather than expressed here).
     */
    seasonNumber: smallint('season_number'),
    courNumber: smallint('cour_number'),

    /**
     * Broadcast season-of-year ("fall 2025") — unrelated to
     * `seasonNumber` above. Two different axes that happen to share the
     * word "season" in English; kept explicitly distinct per product
     * requirement, same as the columns' own names already keep them
     * distinct.
     */
    airingSeason: seasonOfYearEnum('airing_season'),
    airingYear: smallint('airing_year'),

    startDate: date('start_date'),
    endDate: date('end_date'),

    /** Planned episode count; null while unannounced. */
    episodeCount: smallint('episode_count'),
    /** Typical runtime, for the "time to complete" estimate. */
    durationMinutes: smallint('duration_minutes'),

    ageRating: ageRatingEnum('age_rating'),
    /** Gates the title behind the mature-content preference. */
    isAdult: boolean('is_adult').notNull().default(false),

    posterUrl: text('poster_url'),
    bannerUrl: text('banner_url'),

    /**
     * Manual ordering within a series, for when release order isn't
     * reconstructable from dates alone (an OVA released between two
     * seasons, a movie recap released mid-run). Null means "use date
     * order" — never fabricated.
     */
    releaseOrder: smallint('release_order'),
    /**
     * In-universe order, a separate axis from release order (a prequel
     * movie releases after the TV series it precedes chronologically).
     * Null means unknown — never guessed.
     */
    chronologicalOrder: smallint('chronological_order'),

    /**
     * Part of the main numbered sequence vs. an extra/spin-off release —
     * drives default sort/grouping ("Seasons" vs "Extras" on the detail
     * page) without needing a second table.
     */
    isMainEntry: boolean('is_main_entry').notNull().default(true),

    /**
     * Who added this entry, and on behalf of which group. A specific
     * translator group is credited for adding a specific release — this
     * stays at the Entry level even though rating/library moved to
     * Series, since "who submitted Season 2" is still a per-release fact.
     *
     * Null for seeded and imported rows, which have no submitter.
     */
    createdByUserId: fk('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    /**
     * Deliberately without a foreign key: `translators.ts` imports this
     * file, so referencing `translator_groups` here would create an
     * import cycle between the two schema modules. The constraint is
     * added in the migration instead, where no module ordering applies.
     */
    createdByGroupId: fk('created_by_group_id'),

    /**
     * External-source identifiers, for the AniList/MAL importer
     * (`packages/importer`) to dedup on re-sync rather than creating a
     * duplicate row every run. Both null for every hand-created and
     * hand-seeded entry — only rows this importer touches ever have them.
     * Deliberately plain `integer`, not a foreign key to anything: these
     * reference an ID space outside this database entirely.
     */
    anilistId: integer('anilist_id'),
    malId: integer('mal_id'),

    ...timestamps(),
    deletedAt: deletedAt(),
  },
  (table) => [
    uniqueIndex('entries_series_slug_key').on(table.seriesId, table.slug),
    index('entries_series_idx').on(table.seriesId),
    // "What has this group added?" — the moderation view when a group's
    // catalogue entries need reviewing together.
    index('entries_created_by_group_idx').on(table.createdByGroupId),

    // Partial: only enforced when set, so the many rows with neither id
    // (everything hand-created/seeded) never collide on a shared NULL.
    uniqueIndex('entries_anilist_id_key').on(table.anilistId).where(sql`${table.anilistId} is not null`),
    uniqueIndex('entries_mal_id_key').on(table.malId).where(sql`${table.malId} is not null`),

    // The seasonal calendar: "what aired in fall 2025".
    index('entries_airing_idx')
      .on(table.airingYear, table.airingSeason)
      .where(sql`${table.deletedAt} is null`),

    index('entries_status_idx').on(table.status).where(sql`${table.deletedAt} is null`),
    index('entries_type_idx').on(table.entryType).where(sql`${table.deletedAt} is null`),

    // Trigram index for fuzzy title search across individual releases.
    index('entries_title_trgm_idx').using('gin', sql`${table.titleRomaji} gin_trgm_ops`),
  ],
);

/**
 * Alternate and localized Entry titles.
 *
 * Separate from `entries` because the count is unbounded: synonyms,
 * regional titles, and abbreviations users actually search for ("FMAB",
 * "SnK").
 */
export const entryTitles = pgTable(
  'entry_titles',
  {
    id: primaryId(),
    entryId: fk('entry_id')
      .references(() => entries.id, { onDelete: 'cascade' })
      .notNull(),

    kind: titleKindEnum('kind').notNull(),
    title: varchar('title', { length: 255 }).notNull(),
    /** BCP-47 tag when the title is locale-specific. */
    locale: varchar('locale', { length: 10 }),

    ...timestamps(),
  },
  (table) => [
    uniqueIndex('entry_titles_unique').on(table.entryId, table.kind, table.title),
    index('entry_titles_search_idx').using('gin', sql`${table.title} gin_trgm_ops`),
  ],
);

/**
 * A directed relation edge between two entries (e.g. "this OVA is Season
 * 1's sequel"). The inverse edge is not auto-created as a second row —
 * the read side derives "what precedes this Entry" by querying this table
 * in both directions, which keeps writes simple and avoids two rows ever
 * describing one relationship inconsistently.
 */
export const entryRelations = pgTable(
  'entry_relations',
  {
    id: primaryId(),
    fromEntryId: fk('from_entry_id')
      .references(() => entries.id, { onDelete: 'cascade' })
      .notNull(),
    toEntryId: fk('to_entry_id')
      .references(() => entries.id, { onDelete: 'cascade' })
      .notNull(),

    relationType: entryRelationTypeEnum('relation_type').notNull(),
    /**
     * `anilist` rows are written and overwritten freely by the sync path;
     * `manual` rows (an admin's own curated correction) are never touched
     * by sync — this is what makes "AniList sync must not destroy manual
     * structure" enforceable rather than a comment nobody checks.
     */
    source: entryRelationSourceEnum('source').notNull(),

    ...timestamps(),
  },
  (table) => [
    uniqueIndex('entry_relations_unique').on(table.fromEntryId, table.toEntryId, table.relationType),
    index('entry_relations_from_idx').on(table.fromEntryId),
    index('entry_relations_to_idx').on(table.toEntryId),
  ],
);

export const episodes = pgTable(
  'episodes',
  {
    id: primaryId(),
    entryId: fk('entry_id')
      .references(() => entries.id, { onDelete: 'cascade' })
      .notNull(),

    /** Number within the entry. */
    number: smallint('number').notNull(),
    /** Continuous number across the whole series, for "episode 87 of 220". */
    absoluteNumber: smallint('absolute_number'),

    episodeType: episodeTypeEnum('episode_type').notNull().default('regular'),

    title: varchar('title', { length: 255 }),
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

    /** Who added this episode. See the note on `entries.created_by_user_id`. */
    createdByUserId: fk('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdByGroupId: fk('created_by_group_id'),

    ...timestamps(),
    deletedAt: deletedAt(),
  },
  (table) => [
    // An entry cannot have two episode 3s. Unlike the old
    // (animeId, seasonId, number) index this replaces, entryId is NOT
    // NULL, so this constraint actually enforces uniqueness instead of
    // silently no-op'ing whenever the scoping column was NULL.
    uniqueIndex('episodes_entry_number_key').on(table.entryId, table.number),
    // The episode list for an entry page, in order.
    index('episodes_entry_number_idx').on(table.entryId, table.number),
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

export const entryGenres = pgTable(
  'entry_genres',
  {
    entryId: fk('entry_id')
      .references(() => entries.id, { onDelete: 'cascade' })
      .notNull(),
    genreId: fk('genre_id')
      .references(() => genres.id, { onDelete: 'cascade' })
      .notNull(),
  },
  (table) => [
    uniqueIndex('entry_genres_pkey').on(table.entryId, table.genreId),
    // Reverse lookup: "all entries in this genre".
    index('entry_genres_genre_idx').on(table.genreId),
  ],
);

/**
 * Descriptive tags, distinct from `genres`.
 *
 * Genres are a small, fixed, curated list ("Action", "Comedy") the catalogue
 * filter UI treats as a closed set; tags are hundreds of free-form descriptive
 * labels ("Time Skip", "Female Protagonist") sourced from AniList's own tag
 * system (`packages/importer`), each with a `category` AniList assigns
 * ("Cast-Traits", "Setting", ...). Kept as a separate table rather than folded
 * into `genres` so the existing genre-filter assumption ("genres are the small
 * curated list") never needs retrofitting.
 */
export const tags = pgTable(
  'tags',
  {
    id: primaryId(),
    slug: varchar('slug', { length: 96 }).notNull(),
    name: varchar('name', { length: 96 }).notNull(),
    namePolish: varchar('name_polish', { length: 96 }),
    category: varchar('category', { length: 64 }),
    /** AniList flags some tags (e.g. "Explicit Sex") as adult-only in isolation. */
    isAdult: boolean('is_adult').notNull().default(false),
    ...timestamps(),
  },
  (table) => [uniqueIndex('tags_slug_key').on(table.slug)],
);

export const entryTags = pgTable(
  'entry_tags',
  {
    entryId: fk('entry_id')
      .references(() => entries.id, { onDelete: 'cascade' })
      .notNull(),
    tagId: fk('tag_id')
      .references(() => tags.id, { onDelete: 'cascade' })
      .notNull(),
    /** AniList's 0-100 per-entry relevance score for this tag, when known. */
    rank: smallint('rank'),
  },
  (table) => [
    uniqueIndex('entry_tags_pkey').on(table.entryId, table.tagId),
    index('entry_tags_tag_idx').on(table.tagId),
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

export const entryOrganizations = pgTable(
  'entry_organizations',
  {
    entryId: fk('entry_id')
      .references(() => entries.id, { onDelete: 'cascade' })
      .notNull(),
    organizationId: fk('organization_id')
      .references(() => organizations.id, { onDelete: 'cascade' })
      .notNull(),
    role: organizationRoleEnum('role').notNull(),
    /** The lead studio, shown on the card. */
    isPrimary: boolean('is_primary').notNull().default(false),
  },
  (table) => [
    uniqueIndex('entry_organizations_pkey').on(table.entryId, table.organizationId, table.role),
    index('entry_organizations_org_idx').on(table.organizationId),
  ],
);

/**
 * Artwork and trailers.
 *
 * One table for every asset kind, discriminated by `kind`, because they share
 * dimensions, a blurhash, and a language. Separate poster/banner/logo tables
 * would triple the schema for no gain.
 *
 * Attached to `entries` (an Entry's own key visual can differ from its
 * series' default art) and optionally to `series` directly (the series'
 * own default poster/banner, shown on browse/search cards before any one
 * entry is picked) as well as to individual episodes (thumbnails).
 */
export const mediaAssets = pgTable(
  'media_assets',
  {
    id: primaryId(),
    seriesId: fk('series_id').references(() => series.id, { onDelete: 'cascade' }),
    entryId: fk('entry_id').references(() => entries.id, { onDelete: 'cascade' }),
    episodeId: fk('episode_id').references(() => episodes.id, { onDelete: 'cascade' }),

    kind: mediaAssetKindEnum('kind').notNull(),
    url: text('url').notNull(),

    width: smallint('width'),
    height: smallint('height'),
    /** Blurhash placeholder, so cards do not flash while artwork loads. */
    blurhash: varchar('blurhash', { length: 64 }),

    /** Language of a localized poster or a subtitled trailer. */
    locale: varchar('locale', { length: 10 }),
    /** The default asset of this kind for this owner. */
    isPrimary: boolean('is_primary').notNull().default(false),

    ...timestamps(),
  },
  (table) => [
    index('media_assets_series_kind_idx').on(table.seriesId, table.kind),
    index('media_assets_entry_kind_idx').on(table.entryId, table.kind),
    index('media_assets_episode_kind_idx').on(table.episodeId, table.kind),
    // Exactly one primary asset per kind per series.
    uniqueIndex('media_assets_series_primary_key')
      .on(table.seriesId, table.kind)
      .where(sql`${table.isPrimary} = true and ${table.seriesId} is not null`),
    // Exactly one primary asset per kind per entry.
    uniqueIndex('media_assets_entry_primary_key')
      .on(table.entryId, table.kind)
      .where(sql`${table.isPrimary} = true and ${table.entryId} is not null`),
  ],
);

/* -------------------------------------------------------------------------- */
/* Relations                                                                   */
/* -------------------------------------------------------------------------- */

export const franchisesRelations = relations(franchises, ({ many }) => ({
  series: many(series),
}));

export const seriesRelations = relations(series, ({ one, many }) => ({
  franchise: one(franchises, { fields: [series.franchiseId], references: [franchises.id] }),
  entries: many(entries),
  assets: many(mediaAssets),
}));

export const entriesRelations = relations(entries, ({ one, many }) => ({
  series: one(series, { fields: [entries.seriesId], references: [series.id] }),
  titles: many(entryTitles),
  episodes: many(episodes),
  genres: many(entryGenres),
  tags: many(entryTags),
  organizations: many(entryOrganizations),
  assets: many(mediaAssets),
  relationsFrom: many(entryRelations, { relationName: 'entryRelationsFrom' }),
  relationsTo: many(entryRelations, { relationName: 'entryRelationsTo' }),
}));

export const entryTitlesRelations = relations(entryTitles, ({ one }) => ({
  entry: one(entries, { fields: [entryTitles.entryId], references: [entries.id] }),
}));

export const entryRelationsRelations = relations(entryRelations, ({ one }) => ({
  fromEntry: one(entries, {
    fields: [entryRelations.fromEntryId],
    references: [entries.id],
    relationName: 'entryRelationsFrom',
  }),
  toEntry: one(entries, {
    fields: [entryRelations.toEntryId],
    references: [entries.id],
    relationName: 'entryRelationsTo',
  }),
}));

export const episodesRelations = relations(episodes, ({ one }) => ({
  entry: one(entries, { fields: [episodes.entryId], references: [entries.id] }),
}));

export const entryGenresRelations = relations(entryGenres, ({ one }) => ({
  entry: one(entries, { fields: [entryGenres.entryId], references: [entries.id] }),
  genre: one(genres, { fields: [entryGenres.genreId], references: [genres.id] }),
}));

export const entryTagsRelations = relations(entryTags, ({ one }) => ({
  entry: one(entries, { fields: [entryTags.entryId], references: [entries.id] }),
  tag: one(tags, { fields: [entryTags.tagId], references: [tags.id] }),
}));

export const entryOrganizationsRelations = relations(entryOrganizations, ({ one }) => ({
  entry: one(entries, { fields: [entryOrganizations.entryId], references: [entries.id] }),
  organization: one(organizations, {
    fields: [entryOrganizations.organizationId],
    references: [organizations.id],
  }),
}));

export const mediaAssetsRelations = relations(mediaAssets, ({ one }) => ({
  series: one(series, { fields: [mediaAssets.seriesId], references: [series.id] }),
  entry: one(entries, { fields: [mediaAssets.entryId], references: [entries.id] }),
  episode: one(episodes, { fields: [mediaAssets.episodeId], references: [episodes.id] }),
}));

export type FranchiseRow = typeof franchises.$inferSelect;
export type SeriesRow = typeof series.$inferSelect;
export type NewSeriesRow = typeof series.$inferInsert;
export type EntryRow = typeof entries.$inferSelect;
export type NewEntryRow = typeof entries.$inferInsert;
export type EntryRelationRow = typeof entryRelations.$inferSelect;
export type EpisodeRow = typeof episodes.$inferSelect;
export type GenreRow = typeof genres.$inferSelect;
export type TagRow = typeof tags.$inferSelect;
export type MediaAssetRow = typeof mediaAssets.$inferSelect;
