import { Type, type Static } from '@sinclair/typebox';
import { CursorPageOf, CursorQuery, IsoDateTime, Slug, Uuid, literalUnion } from '../common/index.js';

/**
 * Platform blog — announcements and news, authored by staff.
 *
 * Deliberately its own small resource, not folded into `catalogue` or
 * `admin`: a post has no relation to any anime/entry/episode row, and its
 * authoring surface (title, markdown body, publish state) doesn't share
 * meaningful shape with anything else in the catalogue-authoring flow.
 *
 * Draft/published lifecycle with an optional future `publishedAt`: a post
 * can be written now and scheduled to go live later, same as `startedAt`
 * elsewhere in this codebase meaning "future-dated is valid, not an
 * error." The public list/detail routes only ever return posts that are
 * BOTH `status: 'published'` AND whose `publishedAt` has already passed —
 * a scheduled-but-not-yet-live post is invisible to a public reader even
 * though its row already exists, exactly like a scheduled anime episode.
 */

export const BlogPostStatus = {
  DRAFT: 'draft',
  PUBLISHED: 'published',
} as const;
export type BlogPostStatus = (typeof BlogPostStatus)[keyof typeof BlogPostStatus];
export const BLOG_POST_STATUSES = Object.values(BlogPostStatus);

/** A post as a listing card shows it — no full body, so a list page never ships every post's entire markdown. */
export const BlogPostSummaryDto = Type.Object({
  id: Uuid,
  slug: Slug,
  title: Type.String(),
  excerpt: Type.Union([Type.String(), Type.Null()]),
  coverImageUrl: Type.Union([Type.String(), Type.Null()]),
  authorUsername: Type.String(),
  publishedAt: Type.Union([IsoDateTime, Type.Null()]),
});
export type BlogPostSummaryDto = Static<typeof BlogPostSummaryDto>;

/** Full post, including its raw markdown body — the frontend renders it (via `marked`, same library the legal pages already use), never the server. */
export const BlogPostDetailDto = Type.Object({
  id: Uuid,
  slug: Slug,
  title: Type.String(),
  excerpt: Type.Union([Type.String(), Type.Null()]),
  contentMarkdown: Type.String(),
  coverImageUrl: Type.Union([Type.String(), Type.Null()]),
  authorUsername: Type.String(),
  status: literalUnion(BLOG_POST_STATUSES),
  publishedAt: Type.Union([IsoDateTime, Type.Null()]),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type BlogPostDetailDto = Static<typeof BlogPostDetailDto>;

export const BlogPostListQuery = Type.Composite([
  CursorQuery,
  Type.Object({
    /** Admin list only — the public route always behaves as `published`. Enforced server-side, not by trusting this field. */
    status: Type.Optional(literalUnion(BLOG_POST_STATUSES)),
  }),
]);
export type BlogPostListQuery = Static<typeof BlogPostListQuery>;

export const BlogPostListPage = CursorPageOf(BlogPostSummaryDto);
export type BlogPostListPage = Static<typeof BlogPostListPage>;

/**
 * Title is the only required field — `excerpt`/`coverImageUrl` are
 * genuinely optional dressing, and `contentMarkdown` defaults to an empty
 * string so a post can be started from the admin list ("New post") and
 * written in the editor immediately after, rather than needing body text
 * up front.
 */
export const BlogPostCreateBody = Type.Object({
  title: Type.String({ minLength: 1, maxLength: 200 }),
  excerpt: Type.Optional(Type.Union([Type.String({ maxLength: 500 }), Type.Null()])),
  contentMarkdown: Type.Optional(Type.String({ maxLength: 200_000 })),
  coverImageUrl: Type.Optional(Type.Union([Type.String({ maxLength: 2048 }), Type.Null()])),
});
export type BlogPostCreateBody = Static<typeof BlogPostCreateBody>;

export const BlogPostUpdateBody = Type.Object({
  title: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  excerpt: Type.Optional(Type.Union([Type.String({ maxLength: 500 }), Type.Null()])),
  contentMarkdown: Type.Optional(Type.String({ maxLength: 200_000 })),
  coverImageUrl: Type.Optional(Type.Union([Type.String({ maxLength: 2048 }), Type.Null()])),
  status: Type.Optional(literalUnion(BLOG_POST_STATUSES)),
  /**
   * Explicit `null` clears a schedule (back to "publish immediately on
   * status change"); an ISO string schedules or reschedules; omitted
   * leaves whatever is already set untouched.
   */
  publishedAt: Type.Optional(Type.Union([IsoDateTime, Type.Null()])),
});
export type BlogPostUpdateBody = Static<typeof BlogPostUpdateBody>;
