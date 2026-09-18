CREATE TYPE "public"."contact_message_direction" AS ENUM('inbound', 'outbound');--> statement-breakpoint
CREATE TABLE "contact_message_replies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_message_id" uuid NOT NULL,
	"direction" "contact_message_direction" NOT NULL,
	"body" text NOT NULL,
	"sent_by_user_id" uuid,
	"resend_message_id" varchar(254),
	"resend_email_id" varchar(254),
	"from_address" varchar(254),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contact_messages" DROP CONSTRAINT "contact_messages_replied_by_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "contact_message_replies" ADD CONSTRAINT "contact_message_replies_contact_message_id_contact_messages_id_fk" FOREIGN KEY ("contact_message_id") REFERENCES "public"."contact_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_message_replies" ADD CONSTRAINT "contact_message_replies_sent_by_user_id_users_id_fk" FOREIGN KEY ("sent_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contact_message_replies_message_idx" ON "contact_message_replies" USING btree ("contact_message_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_message_replies_resend_email_key" ON "contact_message_replies" USING btree ("resend_email_id") WHERE "contact_message_replies"."resend_email_id" is not null;--> statement-breakpoint
ALTER TABLE "contact_messages" DROP COLUMN "message";--> statement-breakpoint
ALTER TABLE "contact_messages" DROP COLUMN "reply_text";--> statement-breakpoint
ALTER TABLE "contact_messages" DROP COLUMN "replied_by_user_id";--> statement-breakpoint
ALTER TABLE "contact_messages" DROP COLUMN "replied_at";