ALTER TYPE "public"."moderation_action" ADD VALUE 'set_announcement';--> statement-breakpoint
ALTER TYPE "public"."moderation_action" ADD VALUE 'clear_announcement';--> statement-breakpoint
CREATE TABLE "site_announcements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message" text NOT NULL,
	"link_url" text,
	"link_label" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "site_announcements" ADD CONSTRAINT "site_announcements_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "site_announcements_active_idx" ON "site_announcements" USING btree ("created_at" desc) WHERE "site_announcements"."is_active" = true;