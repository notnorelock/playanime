CREATE TABLE "notifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "actor_user_id" uuid,
  "kind" varchar(32) NOT NULL,
  "title" varchar(160) NOT NULL,
  "body" text NOT NULL,
  "href" varchar(512),
  "read_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "notifications_kind_check"
    CHECK ("kind" IN ('follow', 'comment_reply', 'review_reply', 'moderation', 'system'))
);
--> statement-breakpoint
ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_actor_user_id_users_id_fk"
  FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id")
  ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "notifications_user_created_idx"
  ON "notifications" USING btree ("user_id", "created_at" DESC NULLS LAST);
--> statement-breakpoint
CREATE INDEX "notifications_user_unread_idx"
  ON "notifications" USING btree ("user_id", "created_at" DESC NULLS LAST)
  WHERE "read_at" is null;
