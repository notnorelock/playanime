CREATE TABLE "anime_tags" (
	"anime_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"rank" smallint
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(96) NOT NULL,
	"name" varchar(96) NOT NULL,
	"name_polish" varchar(96),
	"category" varchar(64),
	"is_adult" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "anime" ADD COLUMN "anilist_id" integer;--> statement-breakpoint
ALTER TABLE "anime" ADD COLUMN "mal_id" integer;--> statement-breakpoint
ALTER TABLE "anime_tags" ADD CONSTRAINT "anime_tags_anime_id_anime_id_fk" FOREIGN KEY ("anime_id") REFERENCES "public"."anime"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anime_tags" ADD CONSTRAINT "anime_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "anime_tags_pkey" ON "anime_tags" USING btree ("anime_id","tag_id");--> statement-breakpoint
CREATE INDEX "anime_tags_tag_idx" ON "anime_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tags_slug_key" ON "tags" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "anime_anilist_id_key" ON "anime" USING btree ("anilist_id") WHERE "anime"."anilist_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "anime_mal_id_key" ON "anime" USING btree ("mal_id") WHERE "anime"."mal_id" is not null;