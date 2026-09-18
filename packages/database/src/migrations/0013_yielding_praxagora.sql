-- Franchise -> Series -> Entry -> Episode catalogue redesign.
--
-- Unlike a normal schema-only migration, this one carries real data across
-- the reshape: every existing `anime` row becomes one `series` row plus one
-- `entries` row (its slug preserved on the new `series` row so existing
-- `/anime/:slug` links keep resolving), and every table that referenced
-- `anime.id` is repointed to `series.id` (library/rating/comment/progress
-- tables) or `entries.id` (episodes, artwork, taxonomy, translator claims).
--
-- This is safe as a one-shot rewrite rather than a phased backfill only
-- because the live data is confirmed genuinely small (13 anime, 111
-- episodes, 2 franchises, 12 seed-only seasons, 0 cours) — see the design
-- plan for the survey this was based on. Order matters throughout: new
-- tables and columns are created first, data is copied and repointed next,
-- and only the final section drops the old tables/columns/types — so a
-- failure partway through never leaves data stranded with nothing
-- referencing it.

--> statement-breakpoint
-- 1. New enums.
CREATE TYPE "public"."entry_relation_source" AS ENUM('anilist', 'manual');--> statement-breakpoint
CREATE TYPE "public"."entry_relation_type" AS ENUM('sequel', 'prequel', 'side_story', 'spin_off', 'alternative', 'summary', 'parent_story', 'other');--> statement-breakpoint
CREATE TYPE "public"."entry_type" AS ENUM('tv', 'tv_short', 'movie', 'ova', 'ona', 'special', 'recap', 'compilation', 'music', 'web', 'other');--> statement-breakpoint
CREATE TYPE "public"."episode_type" AS ENUM('regular', 'special', 'recap', 'ova', 'ona', 'extra', 'other');--> statement-breakpoint

-- 2. New tables: series, entries, and the entry-scoped taxonomy/relation
-- tables. Created with their columns nullable-where-needed for the data
-- copy step below; NOT NULL constraints that depend on data being present
-- (series_id on entries, entry_id on episodes, etc.) are added after the
-- copy, not declared up front the way a fresh install would.
CREATE TABLE "series" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"franchise_id" uuid,
	"slug" varchar(96) NOT NULL,
	"title" varchar(255) NOT NULL,
	"synopsis" text,
	"poster_url" text,
	"banner_url" text,
	"average_rating" numeric(4, 2),
	"rating_count" integer DEFAULT 0 NOT NULL,
	"popularity_score" integer DEFAULT 0 NOT NULL,
	"member_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"series_id" uuid,
	"slug" varchar(96) NOT NULL,
	"entry_type" "entry_type" NOT NULL,
	"title_romaji" varchar(255) NOT NULL,
	"title_english" varchar(255),
	"title_native" varchar(255),
	"synopsis" text,
	"status" "release_status" DEFAULT 'not_yet_released' NOT NULL,
	"season_number" smallint,
	"cour_number" smallint,
	"airing_season" "season_of_year",
	"airing_year" smallint,
	"start_date" date,
	"end_date" date,
	"episode_count" smallint,
	"duration_minutes" smallint,
	"age_rating" "age_rating",
	"is_adult" boolean DEFAULT false NOT NULL,
	"poster_url" text,
	"banner_url" text,
	"release_order" smallint,
	"chronological_order" smallint,
	"is_main_entry" boolean DEFAULT true NOT NULL,
	"created_by_user_id" uuid,
	"created_by_group_id" uuid,
	"anilist_id" integer,
	"mal_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "entry_genres" (
	"entry_id" uuid NOT NULL,
	"genre_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entry_organizations" (
	"entry_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"role" "organization_role" NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entry_relations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_entry_id" uuid NOT NULL,
	"to_entry_id" uuid NOT NULL,
	"relation_type" "entry_relation_type" NOT NULL,
	"source" "entry_relation_source" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entry_tags" (
	"entry_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"rank" smallint
);
--> statement-breakpoint
CREATE TABLE "entry_titles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid NOT NULL,
	"kind" "title_kind" NOT NULL,
	"title" varchar(255) NOT NULL,
	"locale" varchar(10),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint
-- 3. Data copy: one series + one entry per legacy anime row. The series
-- inherits the anime's slug (so existing /anime/:slug links keep
-- resolving) and its rating/library-relevant fields; the entry gets
-- everything else, keyed back to the anime it came from via anilist_id
-- is NOT used for this join (it can be null/duplicate-free only per
-- partial index) — instead this uses the anime row's own id, temporarily
-- preserved on entries via a join through title_romaji+slug pairing is
-- unnecessary: entries.id is freshly generated but we can correlate by
-- inserting anime.id directly into a temporary mapping using a CTE.
WITH inserted_series AS (
	INSERT INTO "series" (
		"id", "franchise_id", "slug", "title", "synopsis", "poster_url", "banner_url",
		"average_rating", "rating_count", "popularity_score", "member_count",
		"created_at", "updated_at", "deleted_at"
	)
	SELECT
		gen_random_uuid(),
		"franchise_id",
		"slug",
		"title_romaji",
		"synopsis",
		NULL,
		NULL,
		"average_rating",
		"rating_count",
		"popularity_score",
		"member_count",
		"created_at",
		"updated_at",
		"deleted_at"
	FROM "anime"
	RETURNING "id" AS "series_id", "slug"
)
INSERT INTO "entries" (
	"id", "series_id", "slug", "entry_type", "title_romaji", "title_english", "title_native",
	"synopsis", "status", "season_number", "cour_number", "airing_season", "airing_year",
	"start_date", "end_date", "episode_count", "duration_minutes", "age_rating", "is_adult",
	"poster_url", "banner_url", "release_order", "chronological_order", "is_main_entry",
	"created_by_user_id", "created_by_group_id", "anilist_id", "mal_id",
	"created_at", "updated_at", "deleted_at"
)
SELECT
	"anime"."id", -- reuse the anime row's own id as the new entry's id, so every
	              -- existing FK value pointing at anime.id (episodes.anime_id,
	              -- media_assets.anime_id, etc.) already equals the correct new
	              -- entries.id with no separate mapping table needed.
	"inserted_series"."series_id",
	'main',
	"anime"."format"::text::"entry_type",
	"anime"."title_romaji",
	"anime"."title_english",
	"anime"."title_native",
	"anime"."synopsis",
	"anime"."status",
	NULL,
	NULL,
	"anime"."season",
	"anime"."season_year",
	"anime"."start_date",
	"anime"."end_date",
	"anime"."episode_count",
	"anime"."duration_minutes",
	"anime"."age_rating",
	"anime"."is_adult",
	NULL,
	NULL,
	NULL,
	NULL,
	true,
	"anime"."created_by_user_id",
	"anime"."created_by_group_id",
	"anime"."anilist_id",
	"anime"."mal_id",
	"anime"."created_at",
	"anime"."updated_at",
	"anime"."deleted_at"
FROM "anime"
INNER JOIN "inserted_series" ON "inserted_series"."slug" = "anime"."slug";

--> statement-breakpoint
-- Series.id now has no direct correlation back to anime.id (it was
-- randomly generated above and only entries.id reuses anime.id) — every
-- downstream repoint below resolves series_id through entries, whose id
-- equals the legacy anime.id.
--> statement-breakpoint
ALTER TABLE "entries" ALTER COLUMN "series_id" SET NOT NULL;

--> statement-breakpoint
-- 4. Poster artwork: the old media_assets.anime_id rows become entries'
-- own poster (kept on the entry, matching the new schema's "an entry has
-- its own key visual" design) AND the series' default poster (so a
-- browse-grid card, which reads series.poster_url in the new model, is
-- not left blank for every pre-existing title). Both entries.poster_url
-- and series.poster_url are populated from the same legacy row.
UPDATE "entries"
SET "poster_url" = "media_assets"."url"
FROM "media_assets"
WHERE "media_assets"."anime_id" = "entries"."id"
  AND "media_assets"."kind" = 'poster'
  AND "media_assets"."is_primary" = true;
--> statement-breakpoint
UPDATE "series"
SET "poster_url" = "entries"."poster_url"
FROM "entries"
WHERE "entries"."series_id" = "series"."id"
  AND "entries"."is_main_entry" = true
  AND "entries"."poster_url" IS NOT NULL;
--> statement-breakpoint
UPDATE "entries"
SET "banner_url" = "media_assets"."url"
FROM "media_assets"
WHERE "media_assets"."anime_id" = "entries"."id"
  AND "media_assets"."kind" = 'banner'
  AND "media_assets"."is_primary" = true;
--> statement-breakpoint
UPDATE "series"
SET "banner_url" = "entries"."banner_url"
FROM "entries"
WHERE "entries"."series_id" = "series"."id"
  AND "entries"."is_main_entry" = true
  AND "entries"."banner_url" IS NOT NULL;

--> statement-breakpoint
-- 5. Repoint media_assets rows themselves onto the new columns (both a
-- series_id and an entry_id are set for what used to be an anime-scoped
-- asset, since both levels can now show their own artwork and this keeps
-- every legacy asset row visible from either).
ALTER TABLE "media_assets" ADD COLUMN "series_id" uuid;--> statement-breakpoint
ALTER TABLE "media_assets" ADD COLUMN "entry_id" uuid;--> statement-breakpoint
UPDATE "media_assets"
SET "entry_id" = "anime_id"
WHERE "anime_id" IS NOT NULL;
--> statement-breakpoint
UPDATE "media_assets"
SET "series_id" = "entries"."series_id"
FROM "entries"
WHERE "entries"."id" = "media_assets"."entry_id";

--> statement-breakpoint
-- 6. Taxonomy joins (genres/tags/studios) move from anime_id to entry_id
-- 1:1 — the old anime.id equals the new entries.id, so this is a plain
-- column rename via copy, not a join-based rewrite.
INSERT INTO "entry_genres" ("entry_id", "genre_id")
SELECT "anime_id", "genre_id" FROM "anime_genres";
--> statement-breakpoint
INSERT INTO "entry_tags" ("entry_id", "tag_id", "rank")
SELECT "anime_id", "tag_id", "rank" FROM "anime_tags";
--> statement-breakpoint
INSERT INTO "entry_organizations" ("entry_id", "organization_id", "role", "is_primary")
SELECT "anime_id", "organization_id", "role", "is_primary" FROM "anime_organizations";
--> statement-breakpoint
INSERT INTO "entry_titles" ("id", "entry_id", "kind", "title", "locale", "created_at", "updated_at")
SELECT "id", "anime_id", "kind", "title", "locale", "created_at", "updated_at" FROM "anime_titles";

--> statement-breakpoint
-- 7. Episodes: repoint to entry_id (equals the legacy anime_id 1:1), add
-- the new episode_type column, then drop the old season/cour scoping
-- columns (seasons/cours are superseded entirely by Entry.season_number/
-- Entry.cour_number, confirmed unused beyond seed placeholders).
ALTER TABLE "episodes" ADD COLUMN "entry_id" uuid;--> statement-breakpoint
ALTER TABLE "episodes" ADD COLUMN "episode_type" "episode_type" DEFAULT 'regular' NOT NULL;--> statement-breakpoint
UPDATE "episodes" SET "entry_id" = "anime_id";--> statement-breakpoint
ALTER TABLE "episodes" ALTER COLUMN "entry_id" SET NOT NULL;

--> statement-breakpoint
-- 8. Every list/library/progress/social table: animeId -> seriesId,
-- resolved through entries (id = legacy anime_id) -> series_id.
ALTER TABLE "comments" ADD COLUMN "series_id" uuid;--> statement-breakpoint
UPDATE "comments" SET "series_id" = "entries"."series_id" FROM "entries" WHERE "entries"."id" = "comments"."anime_id";--> statement-breakpoint

ALTER TABLE "custom_list_items" ADD COLUMN "series_id" uuid;--> statement-breakpoint
UPDATE "custom_list_items" SET "series_id" = "entries"."series_id" FROM "entries" WHERE "entries"."id" = "custom_list_items"."anime_id";--> statement-breakpoint
ALTER TABLE "custom_list_items" ALTER COLUMN "series_id" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "episode_progress" ADD COLUMN "series_id" uuid;--> statement-breakpoint
UPDATE "episode_progress" SET "series_id" = "entries"."series_id" FROM "entries" WHERE "entries"."id" = "episode_progress"."anime_id";--> statement-breakpoint
ALTER TABLE "episode_progress" ALTER COLUMN "series_id" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "library_entries" ADD COLUMN "series_id" uuid;--> statement-breakpoint
UPDATE "library_entries" SET "series_id" = "entries"."series_id" FROM "entries" WHERE "entries"."id" = "library_entries"."anime_id";--> statement-breakpoint
ALTER TABLE "library_entries" ALTER COLUMN "series_id" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "ratings" ADD COLUMN "series_id" uuid;--> statement-breakpoint
UPDATE "ratings" SET "series_id" = "entries"."series_id" FROM "entries" WHERE "entries"."id" = "ratings"."anime_id";--> statement-breakpoint

ALTER TABLE "reactions" ADD COLUMN "series_id" uuid;--> statement-breakpoint
UPDATE "reactions" SET "series_id" = "entries"."series_id" FROM "entries" WHERE "entries"."id" = "reactions"."anime_id";--> statement-breakpoint

ALTER TABLE "translator_anime" ADD COLUMN "entry_id" uuid;--> statement-breakpoint
UPDATE "translator_anime" SET "entry_id" = "anime_id";--> statement-breakpoint
ALTER TABLE "translator_anime" ALTER COLUMN "entry_id" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "translator_groups" ADD COLUMN "entry_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE "translator_groups" SET "entry_count" = "anime_count";

--> statement-breakpoint
-- 9. catalogue_edit_proposals.target_type: 'anime' -> 'entry' (the enum
-- itself is rebuilt since Postgres cannot rename an enum VALUE in place
-- across a type actually in use without this cast dance).
ALTER TABLE "catalogue_edit_proposals" ALTER COLUMN "target_type" SET DATA TYPE text;--> statement-breakpoint
UPDATE "catalogue_edit_proposals" SET "target_type" = 'entry' WHERE "target_type" = 'anime';--> statement-breakpoint
DROP TYPE "public"."catalogue_proposal_target_type";--> statement-breakpoint
CREATE TYPE "public"."catalogue_proposal_target_type" AS ENUM('entry', 'episode');--> statement-breakpoint
ALTER TABLE "catalogue_edit_proposals" ALTER COLUMN "target_type" SET DATA TYPE "public"."catalogue_proposal_target_type" USING "target_type"::"public"."catalogue_proposal_target_type";

--> statement-breakpoint
-- 10. Foreign keys and indexes on every new/repointed column.
ALTER TABLE "entries" ADD CONSTRAINT "entries_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_genres" ADD CONSTRAINT "entry_genres_entry_id_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_genres" ADD CONSTRAINT "entry_genres_genre_id_genres_id_fk" FOREIGN KEY ("genre_id") REFERENCES "public"."genres"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_organizations" ADD CONSTRAINT "entry_organizations_entry_id_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_organizations" ADD CONSTRAINT "entry_organizations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_relations" ADD CONSTRAINT "entry_relations_from_entry_id_entries_id_fk" FOREIGN KEY ("from_entry_id") REFERENCES "public"."entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_relations" ADD CONSTRAINT "entry_relations_to_entry_id_entries_id_fk" FOREIGN KEY ("to_entry_id") REFERENCES "public"."entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_tags" ADD CONSTRAINT "entry_tags_entry_id_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_tags" ADD CONSTRAINT "entry_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_titles" ADD CONSTRAINT "entry_titles_entry_id_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series" ADD CONSTRAINT "series_franchise_id_franchises_id_fk" FOREIGN KEY ("franchise_id") REFERENCES "public"."franchises"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "entries_series_slug_key" ON "entries" USING btree ("series_id","slug");--> statement-breakpoint
CREATE INDEX "entries_series_idx" ON "entries" USING btree ("series_id");--> statement-breakpoint
CREATE INDEX "entries_created_by_group_idx" ON "entries" USING btree ("created_by_group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "entries_anilist_id_key" ON "entries" USING btree ("anilist_id") WHERE "entries"."anilist_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "entries_mal_id_key" ON "entries" USING btree ("mal_id") WHERE "entries"."mal_id" is not null;--> statement-breakpoint
CREATE INDEX "entries_airing_idx" ON "entries" USING btree ("airing_year","airing_season") WHERE "entries"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "entries_status_idx" ON "entries" USING btree ("status") WHERE "entries"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "entries_type_idx" ON "entries" USING btree ("entry_type") WHERE "entries"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "entries_title_trgm_idx" ON "entries" USING gin ("title_romaji" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "entry_genres_pkey" ON "entry_genres" USING btree ("entry_id","genre_id");--> statement-breakpoint
CREATE INDEX "entry_genres_genre_idx" ON "entry_genres" USING btree ("genre_id");--> statement-breakpoint
CREATE UNIQUE INDEX "entry_organizations_pkey" ON "entry_organizations" USING btree ("entry_id","organization_id","role");--> statement-breakpoint
CREATE INDEX "entry_organizations_org_idx" ON "entry_organizations" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "entry_relations_unique" ON "entry_relations" USING btree ("from_entry_id","to_entry_id","relation_type");--> statement-breakpoint
CREATE INDEX "entry_relations_from_idx" ON "entry_relations" USING btree ("from_entry_id");--> statement-breakpoint
CREATE INDEX "entry_relations_to_idx" ON "entry_relations" USING btree ("to_entry_id");--> statement-breakpoint
CREATE UNIQUE INDEX "entry_tags_pkey" ON "entry_tags" USING btree ("entry_id","tag_id");--> statement-breakpoint
CREATE INDEX "entry_tags_tag_idx" ON "entry_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE UNIQUE INDEX "entry_titles_unique" ON "entry_titles" USING btree ("entry_id","kind","title");--> statement-breakpoint
CREATE INDEX "entry_titles_search_idx" ON "entry_titles" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "series_slug_key" ON "series" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "series_franchise_idx" ON "series" USING btree ("franchise_id");--> statement-breakpoint
CREATE INDEX "series_popularity_idx" ON "series" USING btree ("popularity_score" desc) WHERE "series"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "series_rating_idx" ON "series" USING btree ("average_rating" desc nulls last) WHERE "series"."deleted_at" is null and "series"."rating_count" >= 10;--> statement-breakpoint
CREATE INDEX "series_title_trgm_idx" ON "series" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_entry_id_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_entry_id_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_list_items" ADD CONSTRAINT "custom_list_items_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode_progress" ADD CONSTRAINT "episode_progress_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_entries" ADD CONSTRAINT "library_entries_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "translator_anime" ADD CONSTRAINT "translator_anime_entry_id_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "episodes_entry_number_key" ON "episodes" USING btree ("entry_id","number");--> statement-breakpoint
CREATE INDEX "episodes_entry_number_idx" ON "episodes" USING btree ("entry_id","number");--> statement-breakpoint
CREATE INDEX "media_assets_series_kind_idx" ON "media_assets" USING btree ("series_id","kind");--> statement-breakpoint
CREATE INDEX "media_assets_entry_kind_idx" ON "media_assets" USING btree ("entry_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "media_assets_series_primary_key" ON "media_assets" USING btree ("series_id","kind") WHERE "media_assets"."is_primary" = true and "media_assets"."series_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "media_assets_entry_primary_key" ON "media_assets" USING btree ("entry_id","kind") WHERE "media_assets"."is_primary" = true and "media_assets"."entry_id" is not null;--> statement-breakpoint
CREATE INDEX "comments_series_idx" ON "comments" USING btree ("series_id","created_at" desc) WHERE "comments"."removed_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "custom_list_items_list_series_key" ON "custom_list_items" USING btree ("list_id","series_id");--> statement-breakpoint
CREATE INDEX "episode_progress_user_series_idx" ON "episode_progress" USING btree ("user_id","series_id");--> statement-breakpoint
CREATE UNIQUE INDEX "library_entries_user_series_key" ON "library_entries" USING btree ("user_id","series_id");--> statement-breakpoint
CREATE INDEX "library_entries_series_idx" ON "library_entries" USING btree ("series_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "ratings_user_series_key" ON "ratings" USING btree ("user_id","series_id") WHERE "ratings"."series_id" is not null;--> statement-breakpoint
CREATE INDEX "ratings_series_idx" ON "ratings" USING btree ("series_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reactions_user_series_kind_key" ON "reactions" USING btree ("user_id","series_id","kind") WHERE "reactions"."series_id" is not null;--> statement-breakpoint
CREATE INDEX "reactions_series_idx" ON "reactions" USING btree ("series_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "translator_anime_group_entry_key" ON "translator_anime" USING btree ("group_id","entry_id");--> statement-breakpoint
CREATE INDEX "translator_anime_entry_idx" ON "translator_anime" USING btree ("entry_id");

--> statement-breakpoint
-- 11. Drop old FKs/indexes that referenced anime.id, then the now-unused
-- columns, then the old tables and the retired title_format enum. This is
-- the only irreversible section, deliberately last: every row of data has
-- already been copied and repointed by this point.
ALTER TABLE "episodes" DROP CONSTRAINT "episodes_anime_id_anime_id_fk";--> statement-breakpoint
ALTER TABLE "episodes" DROP CONSTRAINT "episodes_season_id_seasons_id_fk";--> statement-breakpoint
ALTER TABLE "episodes" DROP CONSTRAINT "episodes_cour_id_cours_id_fk";--> statement-breakpoint
ALTER TABLE "media_assets" DROP CONSTRAINT "media_assets_anime_id_anime_id_fk";--> statement-breakpoint
ALTER TABLE "comments" DROP CONSTRAINT "comments_anime_id_anime_id_fk";--> statement-breakpoint
ALTER TABLE "custom_list_items" DROP CONSTRAINT "custom_list_items_anime_id_anime_id_fk";--> statement-breakpoint
ALTER TABLE "episode_progress" DROP CONSTRAINT "episode_progress_anime_id_anime_id_fk";--> statement-breakpoint
ALTER TABLE "library_entries" DROP CONSTRAINT "library_entries_anime_id_anime_id_fk";--> statement-breakpoint
ALTER TABLE "ratings" DROP CONSTRAINT "ratings_anime_id_anime_id_fk";--> statement-breakpoint
ALTER TABLE "reactions" DROP CONSTRAINT "reactions_anime_id_anime_id_fk";--> statement-breakpoint
ALTER TABLE "translator_anime" DROP CONSTRAINT "translator_anime_anime_id_anime_id_fk";--> statement-breakpoint
DROP INDEX "episodes_anime_season_number_key";--> statement-breakpoint
DROP INDEX "episodes_anime_number_idx";--> statement-breakpoint
DROP INDEX "media_assets_anime_kind_idx";--> statement-breakpoint
DROP INDEX "media_assets_primary_key";--> statement-breakpoint
DROP INDEX "comments_anime_idx";--> statement-breakpoint
DROP INDEX "custom_list_items_list_anime_key";--> statement-breakpoint
DROP INDEX "episode_progress_user_anime_idx";--> statement-breakpoint
DROP INDEX "library_entries_user_anime_key";--> statement-breakpoint
DROP INDEX "library_entries_anime_idx";--> statement-breakpoint
DROP INDEX "ratings_user_anime_key";--> statement-breakpoint
DROP INDEX "ratings_anime_idx";--> statement-breakpoint
DROP INDEX "reactions_user_anime_kind_key";--> statement-breakpoint
DROP INDEX "reactions_anime_idx";--> statement-breakpoint
DROP INDEX "translator_anime_group_anime_key";--> statement-breakpoint
DROP INDEX "translator_anime_anime_idx";--> statement-breakpoint
ALTER TABLE "episodes" DROP COLUMN "anime_id";--> statement-breakpoint
ALTER TABLE "episodes" DROP COLUMN "season_id";--> statement-breakpoint
ALTER TABLE "episodes" DROP COLUMN "cour_id";--> statement-breakpoint
ALTER TABLE "episodes" ALTER COLUMN "entry_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "media_assets" DROP COLUMN "anime_id";--> statement-breakpoint
ALTER TABLE "comments" DROP COLUMN "anime_id";--> statement-breakpoint
ALTER TABLE "custom_list_items" DROP COLUMN "anime_id";--> statement-breakpoint
ALTER TABLE "episode_progress" DROP COLUMN "anime_id";--> statement-breakpoint
ALTER TABLE "library_entries" DROP COLUMN "anime_id";--> statement-breakpoint
ALTER TABLE "ratings" DROP COLUMN "anime_id";--> statement-breakpoint
ALTER TABLE "reactions" DROP COLUMN "anime_id";--> statement-breakpoint
ALTER TABLE "translator_anime" DROP COLUMN "anime_id";--> statement-breakpoint
ALTER TABLE "translator_groups" DROP COLUMN "anime_count";--> statement-breakpoint
ALTER TABLE "anime" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "anime_genres" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "anime_organizations" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "anime_tags" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "anime_titles" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cours" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "seasons" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "anime" CASCADE;--> statement-breakpoint
DROP TABLE "anime_genres" CASCADE;--> statement-breakpoint
DROP TABLE "anime_organizations" CASCADE;--> statement-breakpoint
DROP TABLE "anime_tags" CASCADE;--> statement-breakpoint
DROP TABLE "anime_titles" CASCADE;--> statement-breakpoint
DROP TABLE "cours" CASCADE;--> statement-breakpoint
DROP TABLE "seasons" CASCADE;--> statement-breakpoint
DROP TYPE "public"."title_format";
