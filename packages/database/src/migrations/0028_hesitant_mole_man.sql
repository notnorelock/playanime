CREATE TABLE "avatar_uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"storage_path" text NOT NULL,
	"file_size_bytes" integer NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "current_avatar_upload_id" uuid;--> statement-breakpoint
ALTER TABLE "avatar_uploads" ADD CONSTRAINT "avatar_uploads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "avatar_uploads_user_idx" ON "avatar_uploads" USING btree ("user_id","created_at" desc);--> statement-breakpoint
CREATE UNIQUE INDEX "avatar_uploads_user_hash_key" ON "avatar_uploads" USING btree ("user_id","content_hash") WHERE "avatar_uploads"."deleted_at" is null;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_current_avatar_upload_id_avatar_uploads_id_fk" FOREIGN KEY ("current_avatar_upload_id") REFERENCES "public"."avatar_uploads"("id") ON DELETE set null ON UPDATE no action;