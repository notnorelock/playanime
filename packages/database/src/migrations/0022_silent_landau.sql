DROP INDEX "episodes_entry_number_key";--> statement-breakpoint
CREATE UNIQUE INDEX "episodes_entry_number_key" ON "episodes" USING btree ("entry_id","number") WHERE "episodes"."deleted_at" is null;