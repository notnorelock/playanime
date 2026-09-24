import { Type, type Static } from '@sinclair/typebox';
import { IsoDateTime, Uuid } from '../common/index.js';

/**
 * Admin-editable static content pages — see the schema's own doc comment
 * (`packages/database/src/schema/pages.ts`) for why this is a fixed-slug
 * single-version table, not the blog.
 */

/** Known page slugs — the small, fixed set this app actually routes to. Not an open string: a typo'd slug should fail at the type level, not 404 silently in production. */
export const SitePageSlug = {
  VIP: 'vip',
} as const;
export type SitePageSlug = (typeof SitePageSlug)[keyof typeof SitePageSlug];
export const SITE_PAGE_SLUGS = Object.values(SitePageSlug);

/** What the public route reads — null when the page has never been written yet. */
export const SitePageDto = Type.Union([
  Type.Object({
    id: Uuid,
    slug: Type.String(),
    title: Type.String(),
    contentMarkdown: Type.String(),
    updatedAt: IsoDateTime,
  }),
  Type.Null(),
]);
export type SitePageDto = Static<typeof SitePageDto>;

export const SitePageUpdateBody = Type.Object({
  title: Type.String({ minLength: 1, maxLength: 200 }),
  contentMarkdown: Type.String({ maxLength: 100_000 }),
});
export type SitePageUpdateBody = Static<typeof SitePageUpdateBody>;
