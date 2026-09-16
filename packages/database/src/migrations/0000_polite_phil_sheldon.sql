CREATE TYPE "public"."age_rating" AS ENUM('g', 'pg', 'pg_13', 'r_17', 'r_plus', 'rx');--> statement-breakpoint
CREATE TYPE "public"."availability_status" AS ENUM('unknown', 'available', 'unavailable', 'not_checkable');--> statement-breakpoint
CREATE TYPE "public"."media_asset_kind" AS ENUM('poster', 'banner', 'logo', 'thumbnail', 'trailer');--> statement-breakpoint
CREATE TYPE "public"."media_provider" AS ENUM('youtube', 'google-drive', 'cda', 'vidoza', 'mp4upload', 'sibnet', 'rumble', 'external-link');--> statement-breakpoint
CREATE TYPE "public"."moderation_action" AS ENUM('approve_source', 'reject_source', 'disable_source', 'block_source', 'restore_source', 'mark_unavailable', 'apply_copyright_claim', 'remove_comment', 'resolve_report', 'dismiss_report', 'block_domain', 'sanction_user');--> statement-breakpoint
CREATE TYPE "public"."organization_role" AS ENUM('studio', 'producer', 'licensor');--> statement-breakpoint
CREATE TYPE "public"."quality_hint" AS ENUM('sd', '720p', '1080p', '1440p', '2160p', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."reaction_kind" AS ENUM('love', 'fire', 'cry', 'laugh', 'shock', 'think');--> statement-breakpoint
CREATE TYPE "public"."release_status" AS ENUM('not_yet_released', 'releasing', 'finished', 'hiatus', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."report_status" AS ENUM('open', 'under_review', 'action_taken', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."report_target_type" AS ENUM('episode_source', 'comment', 'review', 'user', 'anime');--> statement-breakpoint
CREATE TYPE "public"."report_type" AS ENUM('copyright', 'source_unavailable', 'wrong_episode', 'malicious_source', 'misleading_metadata', 'inappropriate_comment', 'other');--> statement-breakpoint
CREATE TYPE "public"."season_of_year" AS ENUM('winter', 'spring', 'summer', 'fall');--> statement-breakpoint
CREATE TYPE "public"."source_kind" AS ENUM('sub', 'dub', 'raw');--> statement-breakpoint
CREATE TYPE "public"."source_language" AS ENUM('pl', 'en', 'ja', 'other');--> statement-breakpoint
CREATE TYPE "public"."source_status" AS ENUM('pending', 'active', 'unavailable', 'disabled', 'blocked', 'removed', 'copyright_claim', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."title_format" AS ENUM('tv', 'tv_short', 'movie', 'ova', 'ona', 'special', 'music');--> statement-breakpoint
CREATE TYPE "public"."title_kind" AS ENUM('romaji', 'english', 'native', 'polish', 'synonym');--> statement-breakpoint
CREATE TYPE "public"."translator_role" AS ENUM('leader', 'editor', 'translator', 'timer', 'typesetter', 'member');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('user', 'moderator', 'admin');--> statement-breakpoint
CREATE TYPE "public"."watch_status" AS ENUM('watching', 'planned', 'completed', 'paused', 'dropped');--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"display_name" varchar(64),
	"bio" varchar(500),
	"avatar_url" text,
	"banner_url" text,
	"follower_count" integer DEFAULT 0 NOT NULL,
	"following_count" integer DEFAULT 0 NOT NULL,
	"completed_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"locale" varchar(10) DEFAULT 'pl' NOT NULL,
	"preferred_audio_language" "source_language",
	"preferred_subtitle_language" "source_language" DEFAULT 'pl',
	"show_mature_content" boolean DEFAULT false NOT NULL,
	"autoplay_next_episode" boolean DEFAULT true NOT NULL,
	"skip_intro_automatically" boolean DEFAULT false NOT NULL,
	"email_notifications" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(254) NOT NULL,
	"email_verified_at" timestamp with time zone,
	"username" varchar(32) NOT NULL,
	"password_hash" text,
	"role" "user_role" DEFAULT 'user' NOT NULL,
	"suspended_at" timestamp with time zone,
	"suspended_until" timestamp with time zone,
	"suspension_reason" text,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "oauth_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" varchar(32) NOT NULL,
	"provider_account_id" varchar(255) NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"token_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_agent" varchar(512),
	"ip_address" varchar(45),
	"revoked_at" timestamp with time zone,
	"revoked_reason" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"purpose" varchar(32) NOT NULL,
	"payload" varchar(254),
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "anime" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"franchise_id" uuid,
	"slug" varchar(96) NOT NULL,
	"title_romaji" varchar(255) NOT NULL,
	"title_english" varchar(255),
	"title_native" varchar(255),
	"title_polish" varchar(255),
	"synopsis" text,
	"format" "title_format" NOT NULL,
	"status" "release_status" DEFAULT 'not_yet_released' NOT NULL,
	"season" "season_of_year",
	"season_year" smallint,
	"start_date" date,
	"end_date" date,
	"episode_count" smallint,
	"duration_minutes" smallint,
	"age_rating" "age_rating",
	"is_adult" boolean DEFAULT false NOT NULL,
	"average_rating" numeric(3, 2),
	"rating_count" integer DEFAULT 0 NOT NULL,
	"popularity_score" integer DEFAULT 0 NOT NULL,
	"member_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "anime_genres" (
	"anime_id" uuid NOT NULL,
	"genre_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "anime_organizations" (
	"anime_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"role" "organization_role" NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "anime_titles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"anime_id" uuid NOT NULL,
	"kind" "title_kind" NOT NULL,
	"title" varchar(255) NOT NULL,
	"locale" varchar(10),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cours" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"number" smallint NOT NULL,
	"season" "season_of_year",
	"season_year" smallint,
	"start_date" date,
	"end_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "episodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"anime_id" uuid NOT NULL,
	"season_id" uuid,
	"cour_id" uuid,
	"number" smallint NOT NULL,
	"absolute_number" smallint,
	"title" varchar(255),
	"title_polish" varchar(255),
	"synopsis" text,
	"aired_at" date,
	"duration_seconds" integer,
	"intro_start_seconds" integer,
	"intro_end_seconds" integer,
	"outro_start_seconds" integer,
	"is_filler" boolean DEFAULT false NOT NULL,
	"is_recap" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "franchises" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(96) NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "genres" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(64) NOT NULL,
	"name" varchar(64) NOT NULL,
	"name_polish" varchar(64),
	"is_mature" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"anime_id" uuid,
	"episode_id" uuid,
	"kind" "media_asset_kind" NOT NULL,
	"url" text NOT NULL,
	"width" smallint,
	"height" smallint,
	"blurhash" varchar(64),
	"locale" varchar(10),
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(96) NOT NULL,
	"name" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seasons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"anime_id" uuid NOT NULL,
	"number" smallint NOT NULL,
	"title" varchar(255),
	"start_date" date,
	"end_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blocked_resources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" "media_provider" NOT NULL,
	"external_id" varchar(512),
	"domain" varchar(253),
	"reason" text NOT NULL,
	"blocked_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "episode_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"episode_id" uuid NOT NULL,
	"provider" "media_provider" NOT NULL,
	"external_id" varchar(512) NOT NULL,
	"resource_key" varchar(128),
	"canonical_url" text NOT NULL,
	"original_url" text NOT NULL,
	"kind" "source_kind" DEFAULT 'sub' NOT NULL,
	"audio_language" "source_language",
	"subtitle_language" "source_language",
	"quality_hint" "quality_hint",
	"status" "source_status" DEFAULT 'pending' NOT NULL,
	"is_verified" boolean DEFAULT false NOT NULL,
	"priority" smallint DEFAULT 0 NOT NULL,
	"submitted_by_user_id" uuid,
	"rights_attested_at" timestamp with time zone,
	"rights_attestation_text" text,
	"submitter_ip_address" varchar(45),
	"submitter_note" varchar(500),
	"availability" "availability_status" DEFAULT 'unknown' NOT NULL,
	"last_checked_at" timestamp with time zone,
	"last_available_at" timestamp with time zone,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"next_check_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disabled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "comment_likes" (
	"comment_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"anime_id" uuid,
	"episode_id" uuid,
	"parent_id" uuid,
	"body" text NOT NULL,
	"rating" smallint,
	"has_spoilers" boolean DEFAULT false NOT NULL,
	"like_count" integer DEFAULT 0 NOT NULL,
	"reply_count" integer DEFAULT 0 NOT NULL,
	"removed_at" timestamp with time zone,
	"removed_by_user_id" uuid,
	"removal_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "custom_list_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"list_id" uuid NOT NULL,
	"anime_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"note" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "custom_lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"slug" varchar(96) NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" varchar(1000),
	"is_public" boolean DEFAULT true NOT NULL,
	"item_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "episode_progress" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"episode_id" uuid NOT NULL,
	"anime_id" uuid NOT NULL,
	"position_seconds" integer DEFAULT 0 NOT NULL,
	"duration_seconds" integer,
	"is_completed" boolean DEFAULT false NOT NULL,
	"completed_at" timestamp with time zone,
	"last_watched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "follows" (
	"follower_id" uuid NOT NULL,
	"following_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "library_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"anime_id" uuid NOT NULL,
	"status" "watch_status" DEFAULT 'planned' NOT NULL,
	"progress_episodes" smallint DEFAULT 0 NOT NULL,
	"rewatch_count" smallint DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"notes" varchar(1000),
	"is_private" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ratings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"anime_id" uuid,
	"episode_id" uuid,
	"score" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"anime_id" uuid,
	"episode_id" uuid,
	"kind" "reaction_kind" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "translator_anime" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"anime_id" uuid NOT NULL,
	"episode_range" varchar(64),
	"note" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "translator_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"message" varchar(1000),
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "translator_episode_credits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"episode_id" uuid NOT NULL,
	"note" varchar(200),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "translator_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(96) NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" varchar(2000),
	"avatar_url" text,
	"banner_url" text,
	"website_url" text,
	"discord_url" text,
	"is_recruiting" boolean DEFAULT false NOT NULL,
	"verified_at" timestamp with time zone,
	"verified_by_user_id" uuid,
	"member_count" integer DEFAULT 0 NOT NULL,
	"anime_count" integer DEFAULT 0 NOT NULL,
	"suspended_at" timestamp with time zone,
	"suspension_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "translator_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "translator_role" DEFAULT 'member' NOT NULL,
	"credit_note" varchar(200),
	"invited_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "moderation_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"action" "moderation_action" NOT NULL,
	"actor_user_id" uuid,
	"actor_system" varchar(64),
	"target_type" varchar(32) NOT NULL,
	"target_id" uuid NOT NULL,
	"previous_status" varchar(32),
	"new_status" varchar(32),
	"reason" text,
	"report_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actor_ip_address" varchar(45),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" varchar(24) NOT NULL,
	"type" "report_type" NOT NULL,
	"target_type" "report_target_type" NOT NULL,
	"target_id" uuid NOT NULL,
	"reporter_user_id" uuid,
	"reporter_email" varchar(254),
	"reporter_name" varchar(200),
	"reporter_ip_address" varchar(45),
	"reason" varchar(200) NOT NULL,
	"description" text,
	"rights_holder_attested_at" timestamp with time zone,
	"status" "report_status" DEFAULT 'open' NOT NULL,
	"reviewed_at" timestamp with time zone,
	"reviewed_by_user_id" uuid,
	"resolution" text,
	"internal_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_sanctions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" varchar(32) NOT NULL,
	"reason" text NOT NULL,
	"expires_at" timestamp with time zone,
	"issued_by_user_id" uuid,
	"lifted_at" timestamp with time zone,
	"lifted_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "watch_parties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invite_code" varchar(16) NOT NULL,
	"host_user_id" uuid NOT NULL,
	"episode_id" uuid,
	"name" varchar(100),
	"is_public" boolean DEFAULT false NOT NULL,
	"max_members" smallint DEFAULT 20 NOT NULL,
	"ended_at" timestamp with time zone,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "watch_party_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"party_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"can_control_playback" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"left_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "watch_party_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"party_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"body" varchar(1000) NOT NULL,
	"position_seconds" integer,
	"removed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"kind" varchar(32) NOT NULL,
	"title" varchar(160) NOT NULL,
	"body" text NOT NULL,
	"href" varchar(512),
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_kind_check" CHECK ("kind" in ('follow', 'comment_reply', 'review_reply', 'moderation', 'system'))
);
--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_accounts" ADD CONSTRAINT "oauth_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_tokens" ADD CONSTRAINT "verification_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anime" ADD CONSTRAINT "anime_franchise_id_franchises_id_fk" FOREIGN KEY ("franchise_id") REFERENCES "public"."franchises"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anime_genres" ADD CONSTRAINT "anime_genres_anime_id_anime_id_fk" FOREIGN KEY ("anime_id") REFERENCES "public"."anime"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anime_genres" ADD CONSTRAINT "anime_genres_genre_id_genres_id_fk" FOREIGN KEY ("genre_id") REFERENCES "public"."genres"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anime_organizations" ADD CONSTRAINT "anime_organizations_anime_id_anime_id_fk" FOREIGN KEY ("anime_id") REFERENCES "public"."anime"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anime_organizations" ADD CONSTRAINT "anime_organizations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anime_titles" ADD CONSTRAINT "anime_titles_anime_id_anime_id_fk" FOREIGN KEY ("anime_id") REFERENCES "public"."anime"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cours" ADD CONSTRAINT "cours_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_anime_id_anime_id_fk" FOREIGN KEY ("anime_id") REFERENCES "public"."anime"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_cour_id_cours_id_fk" FOREIGN KEY ("cour_id") REFERENCES "public"."cours"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_anime_id_anime_id_fk" FOREIGN KEY ("anime_id") REFERENCES "public"."anime"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seasons" ADD CONSTRAINT "seasons_anime_id_anime_id_fk" FOREIGN KEY ("anime_id") REFERENCES "public"."anime"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocked_resources" ADD CONSTRAINT "blocked_resources_blocked_by_user_id_users_id_fk" FOREIGN KEY ("blocked_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode_sources" ADD CONSTRAINT "episode_sources_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode_sources" ADD CONSTRAINT "episode_sources_submitted_by_user_id_users_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_likes" ADD CONSTRAINT "comment_likes_comment_id_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_likes" ADD CONSTRAINT "comment_likes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_anime_id_anime_id_fk" FOREIGN KEY ("anime_id") REFERENCES "public"."anime"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_removed_by_user_id_users_id_fk" FOREIGN KEY ("removed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_list_items" ADD CONSTRAINT "custom_list_items_list_id_custom_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."custom_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_list_items" ADD CONSTRAINT "custom_list_items_anime_id_anime_id_fk" FOREIGN KEY ("anime_id") REFERENCES "public"."anime"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_lists" ADD CONSTRAINT "custom_lists_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode_progress" ADD CONSTRAINT "episode_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode_progress" ADD CONSTRAINT "episode_progress_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode_progress" ADD CONSTRAINT "episode_progress_anime_id_anime_id_fk" FOREIGN KEY ("anime_id") REFERENCES "public"."anime"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_follower_id_users_id_fk" FOREIGN KEY ("follower_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_following_id_users_id_fk" FOREIGN KEY ("following_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_entries" ADD CONSTRAINT "library_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_entries" ADD CONSTRAINT "library_entries_anime_id_anime_id_fk" FOREIGN KEY ("anime_id") REFERENCES "public"."anime"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_anime_id_anime_id_fk" FOREIGN KEY ("anime_id") REFERENCES "public"."anime"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_anime_id_anime_id_fk" FOREIGN KEY ("anime_id") REFERENCES "public"."anime"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "translator_anime" ADD CONSTRAINT "translator_anime_group_id_translator_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."translator_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "translator_anime" ADD CONSTRAINT "translator_anime_anime_id_anime_id_fk" FOREIGN KEY ("anime_id") REFERENCES "public"."anime"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "translator_applications" ADD CONSTRAINT "translator_applications_group_id_translator_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."translator_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "translator_applications" ADD CONSTRAINT "translator_applications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "translator_applications" ADD CONSTRAINT "translator_applications_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "translator_episode_credits" ADD CONSTRAINT "translator_episode_credits_group_id_translator_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."translator_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "translator_episode_credits" ADD CONSTRAINT "translator_episode_credits_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "translator_groups" ADD CONSTRAINT "translator_groups_verified_by_user_id_users_id_fk" FOREIGN KEY ("verified_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "translator_members" ADD CONSTRAINT "translator_members_group_id_translator_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."translator_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "translator_members" ADD CONSTRAINT "translator_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "translator_members" ADD CONSTRAINT "translator_members_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_audit_log" ADD CONSTRAINT "moderation_audit_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_audit_log" ADD CONSTRAINT "moderation_audit_log_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_user_id_users_id_fk" FOREIGN KEY ("reporter_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_sanctions" ADD CONSTRAINT "user_sanctions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_sanctions" ADD CONSTRAINT "user_sanctions_issued_by_user_id_users_id_fk" FOREIGN KEY ("issued_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_sanctions" ADD CONSTRAINT "user_sanctions_lifted_by_user_id_users_id_fk" FOREIGN KEY ("lifted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watch_parties" ADD CONSTRAINT "watch_parties_host_user_id_users_id_fk" FOREIGN KEY ("host_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watch_parties" ADD CONSTRAINT "watch_parties_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watch_party_members" ADD CONSTRAINT "watch_party_members_party_id_watch_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."watch_parties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watch_party_members" ADD CONSTRAINT "watch_party_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watch_party_messages" ADD CONSTRAINT "watch_party_messages_party_id_watch_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."watch_parties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watch_party_messages" ADD CONSTRAINT "watch_party_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "profiles_user_id_key" ON "profiles" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_preferences_user_id_key" ON "user_preferences" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_key" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_lower_key" ON "users" USING btree (lower("username"));--> statement-breakpoint
CREATE INDEX "users_active_idx" ON "users" USING btree ("created_at") WHERE "users"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_accounts_provider_account_key" ON "oauth_accounts" USING btree ("provider","provider_account_id");--> statement-breakpoint
CREATE INDEX "oauth_accounts_user_idx" ON "oauth_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_active_idx" ON "sessions" USING btree ("user_id","expires_at") WHERE "sessions"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "sessions_expires_at_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "verification_tokens_hash_key" ON "verification_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "verification_tokens_user_purpose_idx" ON "verification_tokens" USING btree ("user_id","purpose","created_at");--> statement-breakpoint
CREATE INDEX "verification_tokens_expires_at_idx" ON "verification_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "anime_slug_key" ON "anime" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "anime_season_idx" ON "anime" USING btree ("season_year","season") WHERE "anime"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "anime_popularity_idx" ON "anime" USING btree ("popularity_score" desc) WHERE "anime"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "anime_rating_idx" ON "anime" USING btree ("average_rating" desc nulls last) WHERE "anime"."deleted_at" is null and "anime"."rating_count" >= 10;--> statement-breakpoint
CREATE INDEX "anime_status_idx" ON "anime" USING btree ("status") WHERE "anime"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "anime_franchise_idx" ON "anime" USING btree ("franchise_id");--> statement-breakpoint
CREATE INDEX "anime_title_trgm_idx" ON "anime" USING gin ("title_romaji" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "anime_genres_pkey" ON "anime_genres" USING btree ("anime_id","genre_id");--> statement-breakpoint
CREATE INDEX "anime_genres_genre_idx" ON "anime_genres" USING btree ("genre_id");--> statement-breakpoint
CREATE UNIQUE INDEX "anime_organizations_pkey" ON "anime_organizations" USING btree ("anime_id","organization_id","role");--> statement-breakpoint
CREATE INDEX "anime_organizations_org_idx" ON "anime_organizations" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "anime_titles_unique" ON "anime_titles" USING btree ("anime_id","kind","title");--> statement-breakpoint
CREATE INDEX "anime_titles_search_idx" ON "anime_titles" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "cours_season_number_key" ON "cours" USING btree ("season_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "episodes_anime_season_number_key" ON "episodes" USING btree ("anime_id","season_id","number");--> statement-breakpoint
CREATE INDEX "episodes_anime_number_idx" ON "episodes" USING btree ("anime_id","number");--> statement-breakpoint
CREATE INDEX "episodes_aired_at_idx" ON "episodes" USING btree ("aired_at") WHERE "episodes"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "franchises_slug_key" ON "franchises" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "genres_slug_key" ON "genres" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "media_assets_anime_kind_idx" ON "media_assets" USING btree ("anime_id","kind");--> statement-breakpoint
CREATE INDEX "media_assets_episode_kind_idx" ON "media_assets" USING btree ("episode_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "media_assets_primary_key" ON "media_assets" USING btree ("anime_id","kind") WHERE "media_assets"."is_primary" = true and "media_assets"."anime_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "seasons_anime_number_key" ON "seasons" USING btree ("anime_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "blocked_resources_provider_external_key" ON "blocked_resources" USING btree ("provider","external_id") WHERE "blocked_resources"."external_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "blocked_resources_domain_key" ON "blocked_resources" USING btree ("domain") WHERE "blocked_resources"."domain" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "episode_sources_resource_key" ON "episode_sources" USING btree ("episode_id","provider","external_id") WHERE "episode_sources"."status" not in ('removed', 'rejected');--> statement-breakpoint
CREATE UNIQUE INDEX "episode_sources_barred_key" ON "episode_sources" USING btree ("provider","external_id") WHERE "episode_sources"."status" in ('blocked', 'copyright_claim');--> statement-breakpoint
CREATE INDEX "episode_sources_playable_idx" ON "episode_sources" USING btree ("episode_id","priority" desc) WHERE "episode_sources"."status" = 'active';--> statement-breakpoint
CREATE INDEX "episode_sources_pending_idx" ON "episode_sources" USING btree ("created_at") WHERE "episode_sources"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "episode_sources_next_check_idx" ON "episode_sources" USING btree ("next_check_at") WHERE "episode_sources"."status" = 'active';--> statement-breakpoint
CREATE INDEX "episode_sources_submitter_idx" ON "episode_sources" USING btree ("submitted_by_user_id");--> statement-breakpoint
CREATE INDEX "episode_sources_provider_idx" ON "episode_sources" USING btree ("provider");--> statement-breakpoint
CREATE UNIQUE INDEX "comment_likes_pkey" ON "comment_likes" USING btree ("comment_id","user_id");--> statement-breakpoint
CREATE INDEX "comment_likes_user_idx" ON "comment_likes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "comments_anime_idx" ON "comments" USING btree ("anime_id","created_at" desc) WHERE "comments"."removed_at" is null;--> statement-breakpoint
CREATE INDEX "comments_episode_idx" ON "comments" USING btree ("episode_id","created_at" desc) WHERE "comments"."removed_at" is null;--> statement-breakpoint
CREATE INDEX "comments_parent_idx" ON "comments" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "comments_user_idx" ON "comments" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "custom_list_items_list_anime_key" ON "custom_list_items" USING btree ("list_id","anime_id");--> statement-breakpoint
CREATE INDEX "custom_list_items_order_idx" ON "custom_list_items" USING btree ("list_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "custom_lists_user_slug_key" ON "custom_lists" USING btree ("user_id","slug");--> statement-breakpoint
CREATE INDEX "custom_lists_public_idx" ON "custom_lists" USING btree ("updated_at" desc) WHERE "custom_lists"."is_public" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "episode_progress_user_episode_key" ON "episode_progress" USING btree ("user_id","episode_id");--> statement-breakpoint
CREATE INDEX "episode_progress_continue_idx" ON "episode_progress" USING btree ("user_id","last_watched_at" desc) WHERE "episode_progress"."is_completed" = false;--> statement-breakpoint
CREATE INDEX "episode_progress_user_anime_idx" ON "episode_progress" USING btree ("user_id","anime_id");--> statement-breakpoint
CREATE UNIQUE INDEX "follows_pkey" ON "follows" USING btree ("follower_id","following_id");--> statement-breakpoint
CREATE INDEX "follows_following_idx" ON "follows" USING btree ("following_id");--> statement-breakpoint
CREATE UNIQUE INDEX "library_entries_user_anime_key" ON "library_entries" USING btree ("user_id","anime_id");--> statement-breakpoint
CREATE INDEX "library_entries_user_status_idx" ON "library_entries" USING btree ("user_id","status","updated_at");--> statement-breakpoint
CREATE INDEX "library_entries_anime_idx" ON "library_entries" USING btree ("anime_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "ratings_user_anime_key" ON "ratings" USING btree ("user_id","anime_id") WHERE "ratings"."anime_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "ratings_user_episode_key" ON "ratings" USING btree ("user_id","episode_id") WHERE "ratings"."episode_id" is not null;--> statement-breakpoint
CREATE INDEX "ratings_anime_idx" ON "ratings" USING btree ("anime_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reactions_user_anime_kind_key" ON "reactions" USING btree ("user_id","anime_id","kind") WHERE "reactions"."anime_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "reactions_user_episode_kind_key" ON "reactions" USING btree ("user_id","episode_id","kind") WHERE "reactions"."episode_id" is not null;--> statement-breakpoint
CREATE INDEX "reactions_anime_idx" ON "reactions" USING btree ("anime_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "translator_anime_group_anime_key" ON "translator_anime" USING btree ("group_id","anime_id");--> statement-breakpoint
CREATE INDEX "translator_anime_anime_idx" ON "translator_anime" USING btree ("anime_id");--> statement-breakpoint
CREATE UNIQUE INDEX "translator_applications_open_key" ON "translator_applications" USING btree ("group_id","user_id") WHERE "translator_applications"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "translator_applications_queue_idx" ON "translator_applications" USING btree ("group_id","created_at") WHERE "translator_applications"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "translator_applications_user_idx" ON "translator_applications" USING btree ("user_id","created_at" desc);--> statement-breakpoint
CREATE UNIQUE INDEX "translator_episode_credits_key" ON "translator_episode_credits" USING btree ("group_id","episode_id");--> statement-breakpoint
CREATE INDEX "translator_episode_credits_episode_idx" ON "translator_episode_credits" USING btree ("episode_id");--> statement-breakpoint
CREATE UNIQUE INDEX "translator_groups_slug_key" ON "translator_groups" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "translator_groups_name_lower_key" ON "translator_groups" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "translator_groups_directory_idx" ON "translator_groups" USING btree ("updated_at" desc) WHERE "translator_groups"."deleted_at" is null and "translator_groups"."suspended_at" is null;--> statement-breakpoint
CREATE INDEX "translator_groups_recruiting_idx" ON "translator_groups" USING btree ("updated_at") WHERE "translator_groups"."is_recruiting" = true and "translator_groups"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "translator_members_group_user_key" ON "translator_members" USING btree ("group_id","user_id");--> statement-breakpoint
CREATE INDEX "translator_members_user_idx" ON "translator_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "translator_members_leaders_idx" ON "translator_members" USING btree ("group_id") WHERE "translator_members"."role" = 'leader';--> statement-breakpoint
CREATE INDEX "moderation_audit_target_idx" ON "moderation_audit_log" USING btree ("target_type","target_id","created_at" desc);--> statement-breakpoint
CREATE INDEX "moderation_audit_actor_idx" ON "moderation_audit_log" USING btree ("actor_user_id","created_at" desc);--> statement-breakpoint
CREATE INDEX "moderation_audit_action_idx" ON "moderation_audit_log" USING btree ("action","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "reports_reference_key" ON "reports" USING btree ("reference");--> statement-breakpoint
CREATE INDEX "reports_open_idx" ON "reports" USING btree ("created_at") WHERE "reports"."status" = 'open';--> statement-breakpoint
CREATE INDEX "reports_target_idx" ON "reports" USING btree ("target_type","target_id","status");--> statement-breakpoint
CREATE INDEX "reports_copyright_idx" ON "reports" USING btree ("created_at") WHERE "reports"."type" = 'copyright' and "reports"."status" in ('open', 'under_review');--> statement-breakpoint
CREATE INDEX "reports_reporter_idx" ON "reports" USING btree ("reporter_user_id");--> statement-breakpoint
CREATE INDEX "user_sanctions_active_idx" ON "user_sanctions" USING btree ("user_id") WHERE "user_sanctions"."lifted_at" is null;--> statement-breakpoint
CREATE INDEX "user_sanctions_user_idx" ON "user_sanctions" USING btree ("user_id","created_at" desc);--> statement-breakpoint
CREATE UNIQUE INDEX "watch_parties_invite_code_key" ON "watch_parties" USING btree ("invite_code");--> statement-breakpoint
CREATE INDEX "watch_parties_public_idx" ON "watch_parties" USING btree ("last_activity_at" desc) WHERE "watch_parties"."is_public" = true and "watch_parties"."ended_at" is null;--> statement-breakpoint
CREATE INDEX "watch_parties_host_idx" ON "watch_parties" USING btree ("host_user_id");--> statement-breakpoint
CREATE INDEX "watch_parties_stale_idx" ON "watch_parties" USING btree ("last_activity_at") WHERE "watch_parties"."ended_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "watch_party_members_active_key" ON "watch_party_members" USING btree ("party_id","user_id") WHERE "watch_party_members"."left_at" is null;--> statement-breakpoint
CREATE INDEX "watch_party_members_party_idx" ON "watch_party_members" USING btree ("party_id");--> statement-breakpoint
CREATE INDEX "watch_party_members_user_idx" ON "watch_party_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "watch_party_messages_party_idx" ON "watch_party_messages" USING btree ("party_id","created_at" desc) WHERE "watch_party_messages"."removed_at" is null;--> statement-breakpoint
CREATE INDEX "notifications_user_created_idx" ON "notifications" USING btree ("user_id","created_at" desc);--> statement-breakpoint
CREATE INDEX "notifications_user_unread_idx" ON "notifications" USING btree ("user_id","created_at" desc) WHERE "notifications"."read_at" is null;