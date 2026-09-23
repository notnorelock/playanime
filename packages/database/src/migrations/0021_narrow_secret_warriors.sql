CREATE TYPE "public"."episode_credit_role" AS ENUM('translation', 'correction', 'qc', 'typesetting');--> statement-breakpoint
DROP INDEX "translator_episode_credits_key";--> statement-breakpoint
DROP INDEX "translator_episode_credits_episode_idx";--> statement-breakpoint
ALTER TABLE "translator_episode_credits" ADD COLUMN "user_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "translator_episode_credits" ADD COLUMN "role" "episode_credit_role" NOT NULL;--> statement-breakpoint
ALTER TABLE "translator_episode_credits" ADD CONSTRAINT "translator_episode_credits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "episode_credits_key" ON "translator_episode_credits" USING btree ("episode_id","user_id","role");--> statement-breakpoint
CREATE INDEX "episode_credits_episode_idx" ON "translator_episode_credits" USING btree ("episode_id");--> statement-breakpoint
CREATE INDEX "episode_credits_user_idx" ON "translator_episode_credits" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "translator_episode_credits" DROP COLUMN "note";