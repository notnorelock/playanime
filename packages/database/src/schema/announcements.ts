import { relations, sql } from 'drizzle-orm';
import { boolean, index, pgTable, text } from 'drizzle-orm/pg-core';
import { fk, primaryId, timestamps } from './_shared.js';
import { users } from './users.js';

/**
 * The homepage announcement strip.
 *
 * One active row at a time, enforced by the service layer (not a DB
 * constraint): setting a new announcement deactivates whatever was active
 * before, in the same transaction. A full history table rather than one
 * mutable row for the same reason `user_sanctions`/`profile_roles` are
 * tables and not columns on `users` — an admin should be able to see what
 * was announced before and by whom, and the public read (`isActive =
 * true`, newest first, limit 1) never needs that history, only the current
 * row.
 */
export const siteAnnouncements = pgTable(
  'site_announcements',
  {
    id: primaryId(),

    message: text('message').notNull(),
    /** Optional "read more" destination — an internal path or an external URL, shown as-is, never validated as one or the other. */
    linkUrl: text('link_url'),
    linkLabel: text('link_label'),

    isActive: boolean('is_active').notNull().default(true),

    createdByUserId: fk('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),

    ...timestamps(),
  },
  (table) => [
    // The public read: the current announcement, if any.
    index('site_announcements_active_idx')
      .on(sql`${table.createdAt} desc`)
      .where(sql`${table.isActive} = true`),
  ],
);

export const siteAnnouncementsRelations = relations(siteAnnouncements, ({ one }) => ({
  createdBy: one(users, { fields: [siteAnnouncements.createdByUserId], references: [users.id] }),
}));

export type SiteAnnouncementRow = typeof siteAnnouncements.$inferSelect;
export type NewSiteAnnouncementRow = typeof siteAnnouncements.$inferInsert;
