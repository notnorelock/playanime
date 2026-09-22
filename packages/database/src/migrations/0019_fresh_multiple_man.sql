CREATE TABLE "profile_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" varchar(32) NOT NULL,
	"reason" text NOT NULL,
	"expires_at" timestamp with time zone,
	"granted_by_user_id" uuid,
	"revoked_at" timestamp with time zone,
	"revoked_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "vip_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "entries" ADD COLUMN "vip_only" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "episodes" ADD COLUMN "early_access_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "profile_roles" ADD CONSTRAINT "profile_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_roles" ADD CONSTRAINT "profile_roles_granted_by_user_id_users_id_fk" FOREIGN KEY ("granted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_roles" ADD CONSTRAINT "profile_roles_revoked_by_user_id_users_id_fk" FOREIGN KEY ("revoked_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "profile_roles_active_idx" ON "profile_roles" USING btree ("user_id","kind") WHERE "profile_roles"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "profile_roles_user_idx" ON "profile_roles" USING btree ("user_id","created_at" desc);