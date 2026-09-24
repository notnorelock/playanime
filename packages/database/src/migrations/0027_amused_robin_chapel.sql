CREATE TYPE "public"."episode_report_reason" AS ENUM('video_not_playing', 'wrong_video', 'wrong_subtitles', 'audio_sync', 'poor_quality', 'other');--> statement-breakpoint
CREATE TYPE "public"."episode_report_status" AS ENUM('open', 'action_taken', 'dismissed');--> statement-breakpoint
ALTER TYPE "public"."moderation_action" ADD VALUE 'resolve_episode_report';--> statement-breakpoint
CREATE TABLE "episode_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"episode_id" uuid NOT NULL,
	"reporter_user_id" uuid NOT NULL,
	"reason" "episode_report_reason" NOT NULL,
	"description" text,
	"status" "episode_report_status" DEFAULT 'open' NOT NULL,
	"reply_text" text,
	"resolved_by_user_id" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "episode_reports" ADD CONSTRAINT "episode_reports_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode_reports" ADD CONSTRAINT "episode_reports_reporter_user_id_users_id_fk" FOREIGN KEY ("reporter_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode_reports" ADD CONSTRAINT "episode_reports_resolved_by_user_id_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "episode_reports_episode_idx" ON "episode_reports" USING btree ("episode_id");--> statement-breakpoint
CREATE INDEX "episode_reports_status_idx" ON "episode_reports" USING btree ("status","created_at" desc);