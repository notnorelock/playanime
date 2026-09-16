ALTER TABLE "anime" ADD COLUMN "created_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "anime" ADD COLUMN "created_by_group_id" uuid;--> statement-breakpoint
ALTER TABLE "episodes" ADD COLUMN "created_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "episodes" ADD COLUMN "created_by_group_id" uuid;--> statement-breakpoint
ALTER TABLE "episode_sources" ADD COLUMN "submitted_by_group_id" uuid;--> statement-breakpoint
ALTER TABLE "episode_sources" ADD COLUMN "moderation_note" varchar(500);--> statement-breakpoint
ALTER TABLE "anime" ADD CONSTRAINT "anime_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "anime_created_by_group_idx" ON "anime" USING btree ("created_by_group_id");--> statement-breakpoint
CREATE INDEX "episode_sources_group_idx" ON "episode_sources" USING btree ("submitted_by_group_id");;--> statement-breakpoint
ALTER TABLE "anime" ADD CONSTRAINT "anime_created_by_group_id_translator_groups_id_fk" FOREIGN KEY ("created_by_group_id") REFERENCES "public"."translator_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_created_by_group_id_translator_groups_id_fk" FOREIGN KEY ("created_by_group_id") REFERENCES "public"."translator_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode_sources" ADD CONSTRAINT "episode_sources_submitted_by_group_id_translator_groups_id_fk" FOREIGN KEY ("submitted_by_group_id") REFERENCES "public"."translator_groups"("id") ON DELETE set null ON UPDATE no action
