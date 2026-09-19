import { relations, sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { blogPostStatusEnum, fk, primaryId, timestamps } from './_shared.js';
import { users } from './users.js';

/**
 * Platform blog — announcements and news, admin-authored. See
 * `packages/contracts/src/blog/index.ts` for the full design rationale
 * (draft/publish/schedule lifecycle, why this is its own resource).
 *
 * `slug` is permanent once a post has ever been published (the authoring
 * service enforces this, not a DB constraint — a draft's slug can still
 * change freely since nothing public links to it yet).
 */
export const blogPosts = pgTable(
  'blog_posts',
  {
    id: primaryId(),

    slug: varchar('slug', { length: 96 }).notNull(),
    title: varchar('title', { length: 200 }).notNull(),
    excerpt: varchar('excerpt', { length: 500 }),
    contentMarkdown: text('content_markdown').notNull().default(''),
    coverImageUrl: text('cover_image_url'),

    authorUserId: fk('author_user_id')
      .references(() => users.id, { onDelete: 'set null' })
      .notNull(),

    status: blogPostStatusEnum('status').notNull().default('draft'),
    /**
     * Nullable even for a published post is intentionally impossible in
     * practice — the service always sets this to "now" or a future time
     * the moment status becomes `published` — but nullable in the schema
     * because a draft genuinely has no publish time yet, and forcing a
     * placeholder value here would be worse than a real null.
     */
    publishedAt: timestamp('published_at', { withTimezone: true, mode: 'date' }),

    ...timestamps(),
  },
  (table) => [
    uniqueIndex('blog_posts_slug_key').on(table.slug),
    // The public list: published posts whose publishedAt has passed, newest first.
    index('blog_posts_status_published_idx').on(table.status, sql`${table.publishedAt} desc`),
  ],
);

export const blogPostsRelations = relations(blogPosts, ({ one }) => ({
  author: one(users, { fields: [blogPosts.authorUserId], references: [users.id] }),
}));

export type BlogPostRow = typeof blogPosts.$inferSelect;
export type NewBlogPostRow = typeof blogPosts.$inferInsert;
