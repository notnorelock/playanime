import { relations, sql } from 'drizzle-orm';
import { index, pgTable, text, varchar } from 'drizzle-orm/pg-core';
import {
  createdAt,
  fk,
  primaryId,
  supportMessageDirectionEnum,
  supportTicketCategoryEnum,
  supportTicketStatusEnum,
} from './_shared.js';
import { users } from './users.js';

/**
 * Support tickets — a logged-in user's own help requests, replied to by
 * staff from the admin panel. See `packages/contracts/src/support/index.ts`
 * for why this is a separate table from `contact` rather than a reuse of it.
 *
 * Same envelope + ordered-thread shape as `contactMessages`/
 * `contactMessageReplies`: `supportTickets` is the conversation envelope,
 * `supportMessages` holds every message in it in order (the ticket's own
 * opening message is the thread's first entry, not a separate field).
 */
export const supportTickets = pgTable(
  'support_tickets',
  {
    id: primaryId(),
    submitterUserId: fk('submitter_user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    category: supportTicketCategoryEnum('category').notNull(),
    subject: varchar('subject', { length: 200 }).notNull(),
    status: supportTicketStatusEnum('status').notNull().default('open'),

    createdAt: createdAt(),
  },
  (table) => [
    // The user's own "my tickets" list, and the staff queue: newest first, filterable by status.
    index('support_tickets_submitter_idx').on(table.submitterUserId, sql`${table.createdAt} desc`),
    index('support_tickets_status_idx').on(table.status, sql`${table.createdAt} desc`),
  ],
);

export const supportMessages = pgTable(
  'support_messages',
  {
    id: primaryId(),
    ticketId: fk('ticket_id')
      .references(() => supportTickets.id, { onDelete: 'cascade' })
      .notNull(),

    direction: supportMessageDirectionEnum('direction').notNull(),
    body: text('body').notNull(),

    /** Staff messages only: which staff member sent it. */
    sentByUserId: fk('sent_by_user_id').references(() => users.id, { onDelete: 'set null' }),

    createdAt: createdAt(),
  },
  (table) => [index('support_messages_ticket_idx').on(table.ticketId, table.createdAt)],
);

export const supportTicketsRelations = relations(supportTickets, ({ one, many }) => ({
  submitter: one(users, { fields: [supportTickets.submitterUserId], references: [users.id] }),
  messages: many(supportMessages),
}));

export const supportMessagesRelations = relations(supportMessages, ({ one }) => ({
  ticket: one(supportTickets, { fields: [supportMessages.ticketId], references: [supportTickets.id] }),
  sentBy: one(users, { fields: [supportMessages.sentByUserId], references: [users.id] }),
}));

export type SupportTicketRow = typeof supportTickets.$inferSelect;
export type NewSupportTicketRow = typeof supportTickets.$inferInsert;
export type SupportMessageRow = typeof supportMessages.$inferSelect;
export type NewSupportMessageRow = typeof supportMessages.$inferInsert;
