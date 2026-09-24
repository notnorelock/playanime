import { pgTable, text, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { fk, primaryId, timestamps } from './_shared.js';
import { users } from './users.js';

/**
 * Admin-editable static content pages — the VIP explainer page today,
 * reusable later for anything else that's "one page of text an admin
 * writes and can edit themselves" without a code change (rules, FAQ).
 *
 * Deliberately not the blog: a blog post is a dated piece of news in a
 * list; a site page is a fixed, slug-addressed destination (`/vip`) with
 * exactly one current version — there is no publish/draft/schedule
 * lifecycle and no history table, unlike `blog_posts` or
 * `site_announcements`. Editing a page overwrites it in place; the only
 * "history" is `updatedAt`.
 *
 * Rows are seeded by the service layer (upsert-on-first-write for a known
 * slug like `vip`), not by a migration — the content itself is product
 * copy, not schema.
 */
export const sitePages = pgTable(
  'site_pages',
  {
    id: primaryId(),

    /** Permanent, code-referenced identifier (e.g. "vip") — not the URL slug users pick, since this app has a fixed, small set of these pages. */
    slug: varchar('slug', { length: 64 }).notNull(),
    title: varchar('title', { length: 200 }).notNull(),
    contentMarkdown: text('content_markdown').notNull().default(''),

    updatedByUserId: fk('updated_by_user_id').references(() => users.id, { onDelete: 'set null' }),

    ...timestamps(),
  },
  (table) => [uniqueIndex('site_pages_slug_key').on(table.slug)],
);

export const sitePagesRelations = relations(sitePages, ({ one }) => ({
  updatedBy: one(users, { fields: [sitePages.updatedByUserId], references: [users.id] }),
}));

export type SitePageRow = typeof sitePages.$inferSelect;
export type NewSitePageRow = typeof sitePages.$inferInsert;
