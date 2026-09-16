CREATE TYPE "public"."device_status" AS ENUM('active', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."device_type" AS ENUM('desktop', 'mobile', 'tablet', 'tv', 'unknown');--> statement-breakpoint
CREATE TABLE "user_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"device_id" varchar(128) NOT NULL,
	"display_name" varchar(100),
	"device_type" "device_type" DEFAULT 'unknown' NOT NULL,
	"browser" varchar(64),
	"os" varchar(64),
	"status" "device_status" DEFAULT 'active' NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"blocked_at" timestamp with time zone,
	"blocked_reason" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "security_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"event_type" varchar(64) NOT NULL,
	"target_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "anime_titles" ALTER COLUMN "kind" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."title_kind";--> statement-breakpoint
CREATE TYPE "public"."title_kind" AS ENUM('romaji', 'english', 'native', 'synonym');--> statement-breakpoint
ALTER TABLE "anime_titles" ALTER COLUMN "kind" SET DATA TYPE "public"."title_kind" USING "kind"::"public"."title_kind";--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "device_id" uuid;--> statement-breakpoint
ALTER TABLE "user_devices" ADD CONSTRAINT "user_devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_events" ADD CONSTRAINT "security_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_devices_user_device_key" ON "user_devices" USING btree ("user_id","device_id");--> statement-breakpoint
CREATE INDEX "user_devices_user_status_idx" ON "user_devices" USING btree ("user_id","status","last_seen_at");--> statement-breakpoint
CREATE INDEX "security_events_actor_idx" ON "security_events" USING btree ("actor_user_id","created_at");--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_device_id_user_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."user_devices"("id") ON DELETE set null ON UPDATE no action;