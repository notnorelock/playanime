ALTER TYPE "public"."moderation_action" ADD VALUE 'takedown_anime' BEFORE 'restore_comment';--> statement-breakpoint
CREATE TABLE "blocked_titles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"anilist_id" integer,
	"mal_id" integer,
	"reason" text NOT NULL,
	"report_id" uuid,
	"blocked_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "blocked_titles" ADD CONSTRAINT "blocked_titles_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocked_titles" ADD CONSTRAINT "blocked_titles_blocked_by_user_id_users_id_fk" FOREIGN KEY ("blocked_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "blocked_titles_anilist_key" ON "blocked_titles" USING btree ("anilist_id") WHERE "blocked_titles"."anilist_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "blocked_titles_mal_key" ON "blocked_titles" USING btree ("mal_id") WHERE "blocked_titles"."mal_id" is not null;