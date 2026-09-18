import { relations, sql } from 'drizzle-orm';
import { index, pgTable, text, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { contactMessageDirectionEnum, contactMessageStatusEnum, createdAt, fk, primaryId, timestamps } from './_shared.js';
import { users } from './users.js';

/**
 * Contact form submissions and (once Resend's inbound receiving is wired
 * up) any other mail sent to the domain.
 *
 * `contactMessages` is the conversation envelope; `contactMessageReplies`
 * holds every message in it, in order, in either direction — the original
 * form submission is itself the thread's first (inbound) entry, not a
 * separate field, so the whole conversation renders off one consistent
 * list. `status` tracks whether the LAST message was inbound (`new` —
 * staff owes a reply) or outbound (`replied`); maintained by whichever
 * write appends the newest entry, not a generated column (Postgres
 * generated columns can't cheaply reference a sibling table).
 */
export const contactMessages = pgTable(
  'contact_messages',
  {
    id: primaryId(),

    name: varchar('name', { length: 200 }).notNull(),
    email: varchar('email', { length: 254 }).notNull(),
    subject: varchar('subject', { length: 200 }).notNull(),

    status: contactMessageStatusEnum('status').notNull().default('new'),

    ...timestamps(),
  },
  (table) => [
    // The staff inbox: newest first, filterable by status.
    index('contact_messages_status_idx').on(table.status, sql`${table.createdAt} desc`),
  ],
);

export const contactMessageReplies = pgTable(
  'contact_message_replies',
  {
    id: primaryId(),
    contactMessageId: fk('contact_message_id')
      .references(() => contactMessages.id, { onDelete: 'cascade' })
      .notNull(),

    direction: contactMessageDirectionEnum('direction').notNull(),
    body: text('body').notNull(),

    /** Outbound only: which staff member sent it. */
    sentByUserId: fk('sent_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    /**
     * Outbound only: the id Resend returned for this send, captured so the
     * NEXT inbound reply (whose `In-Reply-To` header names this id) can be
     * matched back to this thread.
     */
    resendMessageId: varchar('resend_message_id', { length: 254 }),

    /** Inbound only: Resend's own `email_id` for this received message. */
    resendEmailId: varchar('resend_email_id', { length: 254 }),
    /** Inbound only: the sender's address, which may differ from the envelope's `email` for a forwarded/CC'd reply. */
    fromAddress: varchar('from_address', { length: 254 }),

    createdAt: createdAt(),
  },
  (table) => [
    // The thread view: every message for one conversation, in order.
    index('contact_message_replies_message_idx').on(table.contactMessageId, table.createdAt),
    // A redelivered webhook for the same received email must not duplicate a row.
    uniqueIndex('contact_message_replies_resend_email_key')
      .on(table.resendEmailId)
      .where(sql`${table.resendEmailId} is not null`),
  ],
);

export const contactMessagesRelations = relations(contactMessages, ({ many }) => ({
  replies: many(contactMessageReplies),
}));

export const contactMessageRepliesRelations = relations(contactMessageReplies, ({ one }) => ({
  contactMessage: one(contactMessages, {
    fields: [contactMessageReplies.contactMessageId],
    references: [contactMessages.id],
  }),
  sentBy: one(users, { fields: [contactMessageReplies.sentByUserId], references: [users.id] }),
}));

export type ContactMessageRow = typeof contactMessages.$inferSelect;
export type NewContactMessageRow = typeof contactMessages.$inferInsert;
export type ContactMessageReplyRow = typeof contactMessageReplies.$inferSelect;
export type NewContactMessageReplyRow = typeof contactMessageReplies.$inferInsert;
