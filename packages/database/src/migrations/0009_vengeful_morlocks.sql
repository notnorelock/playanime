CREATE TYPE "public"."catalogue_proposal_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."catalogue_proposal_target_type" AS ENUM('anime', 'episode');--> statement-breakpoint
ALTER TYPE "public"."moderation_action" ADD VALUE 'update_episode' BEFORE 'hide_anime';--> statement-breakpoint
ALTER TYPE "public"."moderation_action" ADD VALUE 'propose_catalogue_edit' BEFORE 'hide_anime';--> statement-breakpoint
ALTER TYPE "public"."moderation_action" ADD VALUE 'approve_catalogue_edit' BEFORE 'hide_anime';--> statement-breakpoint
ALTER TYPE "public"."moderation_action" ADD VALUE 'reject_catalogue_edit' BEFORE 'hide_anime';--> statement-breakpoint
CREATE TABLE "catalogue_edit_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_type" "catalogue_proposal_target_type" NOT NULL,
	"target_id" uuid NOT NULL,
	"proposed_by_user_id" uuid NOT NULL,
	"proposed_by_group_id" uuid,
	"changes" jsonb NOT NULL,
	"status" "catalogue_proposal_status" DEFAULT 'pending' NOT NULL,
	"decided_by_user_id" uuid,
	"decided_at" timestamp with time zone,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "catalogue_edit_proposals" ADD CONSTRAINT "catalogue_edit_proposals_proposed_by_user_id_users_id_fk" FOREIGN KEY ("proposed_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalogue_edit_proposals" ADD CONSTRAINT "catalogue_edit_proposals_proposed_by_group_id_translator_groups_id_fk" FOREIGN KEY ("proposed_by_group_id") REFERENCES "public"."translator_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalogue_edit_proposals" ADD CONSTRAINT "catalogue_edit_proposals_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "catalogue_edit_proposals_target_idx" ON "catalogue_edit_proposals" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "catalogue_edit_proposals_status_idx" ON "catalogue_edit_proposals" USING btree ("status","created_at" desc) WHERE "catalogue_edit_proposals"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "catalogue_edit_proposals_group_idx" ON "catalogue_edit_proposals" USING btree ("proposed_by_group_id");