import { desc, eq } from 'drizzle-orm';
import { AdminRepository, db, siteAnnouncements, users, type Database } from '@playanime/database';
import type { ActiveAnnouncementDto, AnnouncementDto, AnnouncementSetBody } from '@playanime/contracts';

/**
 * The homepage announcement strip — see the schema's own doc comment
 * (`packages/database/src/schema/announcements.ts`) for why this is a
 * small history table with one active row, not a single mutable row.
 *
 * No repository class, matching `blog`'s own module: a single simple
 * table with no cross-module read pattern anything else needs.
 */

const adminRepository = new AdminRepository(db());

/** The current announcement, or null when there is none. Public — no auth required to read it, same as the homepage itself. */
export async function getActiveAnnouncement(database: Database = db()): Promise<ActiveAnnouncementDto> {
  const [row] = await database
    .select({
      id: siteAnnouncements.id,
      message: siteAnnouncements.message,
      linkUrl: siteAnnouncements.linkUrl,
      linkLabel: siteAnnouncements.linkLabel,
      createdAt: siteAnnouncements.createdAt,
    })
    .from(siteAnnouncements)
    .where(eq(siteAnnouncements.isActive, true))
    .orderBy(desc(siteAnnouncements.createdAt))
    .limit(1);

  if (row === undefined) return null;

  return {
    id: row.id,
    message: row.message,
    linkUrl: row.linkUrl,
    linkLabel: row.linkLabel,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Staff-only history — every announcement ever set, newest first, including who set it. */
export async function listAnnouncements(database: Database = db()): Promise<AnnouncementDto[]> {
  const rows = await database
    .select({
      id: siteAnnouncements.id,
      message: siteAnnouncements.message,
      linkUrl: siteAnnouncements.linkUrl,
      linkLabel: siteAnnouncements.linkLabel,
      isActive: siteAnnouncements.isActive,
      createdByUsername: users.username,
      createdAt: siteAnnouncements.createdAt,
    })
    .from(siteAnnouncements)
    .leftJoin(users, eq(users.id, siteAnnouncements.createdByUserId))
    .orderBy(desc(siteAnnouncements.createdAt))
    .limit(50);

  return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
}

/**
 * Replaces the active announcement with a new one — deactivates whatever
 * was active before and inserts the new row, in one transaction, so there
 * is never a moment with two rows both marked active.
 */
export async function setAnnouncement(
  actorUserId: string,
  body: AnnouncementSetBody,
): Promise<AnnouncementDto> {
  const database = db();

  const created = await database.transaction(async (tx) => {
    await tx
      .update(siteAnnouncements)
      .set({ isActive: false })
      .where(eq(siteAnnouncements.isActive, true));

    const [row] = await tx
      .insert(siteAnnouncements)
      .values({
        message: body.message,
        linkUrl: body.linkUrl ?? null,
        linkLabel: body.linkLabel ?? null,
        createdByUserId: actorUserId,
      })
      .returning();

    if (row === undefined) throw new Error('Announcement insert returned no row.');
    return row;
  });

  await adminRepository.audit({
    action: 'set_announcement',
    actorUserId,
    targetType: 'site_announcement',
    targetId: created.id,
    reason: null,
    metadata: { message: created.message },
  });

  return {
    id: created.id,
    message: created.message,
    linkUrl: created.linkUrl,
    linkLabel: created.linkLabel,
    isActive: created.isActive,
    createdByUsername: null,
    createdAt: created.createdAt.toISOString(),
  };
}

/** Deactivates whatever is currently active, leaving no announcement shown. */
export async function clearAnnouncement(actorUserId: string): Promise<{ success: boolean }> {
  const database = db();

  const [cleared] = await database
    .update(siteAnnouncements)
    .set({ isActive: false })
    .where(eq(siteAnnouncements.isActive, true))
    .returning({ id: siteAnnouncements.id, message: siteAnnouncements.message });

  if (cleared !== undefined) {
    await adminRepository.audit({
      action: 'clear_announcement',
      actorUserId,
      targetType: 'site_announcement',
      targetId: cleared.id,
      reason: null,
      metadata: { message: cleared.message },
    });
  }

  return { success: true };
}
