import { eq } from 'drizzle-orm';
import { AdminRepository, db, sitePages, type Database } from '@playanime/database';
import type { SitePageDto, SitePageUpdateBody } from '@playanime/contracts';

/**
 * Admin-editable static content pages — see the schema's own doc comment
 * (`packages/database/src/schema/pages.ts`) for why this is a single
 * mutable row per slug, not a history table.
 *
 * No repository class, matching `announcements`/`blog`'s own modules: a
 * single simple table with no cross-module read pattern anything else needs.
 */

const adminRepository = new AdminRepository(db());

function toDto(row: typeof sitePages.$inferSelect): SitePageDto {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    contentMarkdown: row.contentMarkdown,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Public read — null when this page has never been written yet. */
export async function getSitePage(slug: string, database: Database = db()): Promise<SitePageDto> {
  const [row] = await database.select().from(sitePages).where(eq(sitePages.slug, slug)).limit(1);
  return row === undefined ? null : toDto(row);
}

/** Admin write — upserts on first write for a known slug, overwrites in place afterward. */
export async function updateSitePage(
  actorUserId: string,
  slug: string,
  body: SitePageUpdateBody,
): Promise<SitePageDto> {
  const database = db();

  const [existing] = await database.select().from(sitePages).where(eq(sitePages.slug, slug)).limit(1);

  const row =
    existing === undefined
      ? (
          await database
            .insert(sitePages)
            .values({ slug, title: body.title, contentMarkdown: body.contentMarkdown, updatedByUserId: actorUserId })
            .returning()
        )[0]
      : (
          await database
            .update(sitePages)
            .set({ title: body.title, contentMarkdown: body.contentMarkdown, updatedByUserId: actorUserId })
            .where(eq(sitePages.slug, slug))
            .returning()
        )[0];

  if (row === undefined) throw new Error('Site page upsert returned no row.');

  await adminRepository.audit({
    action: 'update_site_page',
    actorUserId,
    targetType: 'site_page',
    targetId: row.id,
    reason: null,
    metadata: { slug: row.slug },
  });

  return toDto(row);
}
