CREATE TYPE "public"."support_message_direction" AS ENUM('user', 'staff');--> statement-breakpoint
CREATE TYPE "public"."support_ticket_category" AS ENUM('general', 'collaboration', 'support', 'technical');--> statement-breakpoint
CREATE TYPE "public"."support_ticket_status" AS ENUM('open', 'replied', 'closed');--> statement-breakpoint
ALTER TYPE "public"."moderation_action" ADD VALUE 'reply_support_ticket';--> statement-breakpoint
ALTER TYPE "public"."moderation_action" ADD VALUE 'close_support_ticket';--> statement-breakpoint
CREATE TABLE "support_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"direction" "support_message_direction" NOT NULL,
	"body" text NOT NULL,
	"sent_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submitter_user_id" uuid NOT NULL,
	"category" "support_ticket_category" NOT NULL,
	"subject" varchar(200) NOT NULL,
	"status" "support_ticket_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_ticket_id_support_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."support_tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_sent_by_user_id_users_id_fk" FOREIGN KEY ("sent_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_submitter_user_id_users_id_fk" FOREIGN KEY ("submitter_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "support_messages_ticket_idx" ON "support_messages" USING btree ("ticket_id","created_at");--> statement-breakpoint
CREATE INDEX "support_tickets_submitter_idx" ON "support_tickets" USING btree ("submitter_user_id","created_at" desc);--> statement-breakpoint
CREATE INDEX "support_tickets_status_idx" ON "support_tickets" USING btree ("status","created_at" desc);