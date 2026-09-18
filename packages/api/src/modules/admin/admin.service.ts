import {
  ROLE_RANK,
  type UserRole,
  type AdminAnalyticsQuery,
  type AdminCommentQuery,
  type AdminEntryUpdateBody,
  type AdminOverviewDto,
  type AdminRoleUpdateBody,
  type AdminSanctionBody,
  type AdminSeriesQuery,
  type AdminSeriesUpdateBody,
  type AdminUserQuery,
} from '@playanime/contracts';
import { AdminRepository, TranslatorRepository, db } from '@playanime/database';
import {
  AuthorizationError,
  ErrorCode,
  NotFoundError,
  ValidationError,
  clampPageSize,
  days,
} from '@playanime/shared';
import { toAdminAnime, toAdminComment, toAdminSanction, toAdminUser } from './admin.mapper.js';

/**
 * Platform administration.
 *
 * Two rules run through every function here:
 *
 * - A staff member may never act on someone who outranks them, and may never
 *   grant a role above their own. Without that, one compromised moderator
 *   account escalates to owning the platform.
 * - Every mutation writes an audit row. The log is what answers "who did this
 *   and why" months later, and it is append-only by design.
 */

const repository = new AdminRepository(db());
const translatorRepository = new TranslatorRepository(db());

/** Parses the tri-state boolean that query parameters arrive as. */
function asBoolean(value: boolean | 'true' | 'false' | undefined): boolean {
  return value === true || value === 'true';
}

function cursorDate(cursor: string | undefined): Date | null {
  if (cursor === undefined) return null;
  const parsed = new Date(cursor);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

interface Actor {
  readonly id: string;
  readonly role: UserRole;
}

/**
 * Refuses an action against a peer or a superior.
 *
 * Strictly greater, not greater-or-equal: two moderators must not be able to
 * sanction each other, which would turn any single compromised account into a
 * way to disable the rest of the team.
 */
function assertOutranks(actor: Actor, targetRole: UserRole): void {
  if (ROLE_RANK[actor.role] <= ROLE_RANK[targetRole]) {
    throw new AuthorizationError('Nie możesz wykonać tej akcji wobec tego użytkownika.', {
      code: ErrorCode.INSUFFICIENT_ROLE,
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Users                                                                       */
/* -------------------------------------------------------------------------- */

export async function listUsers(query: AdminUserQuery) {
  const limit = clampPageSize(query.limit);

  const rows = await repository.listUsers(
    {
      search: query.search,
      role: query.role,
      suspendedOnly: asBoolean(query.suspendedOnly),
    },
    limit,
    cursorDate(query.cursor),
  );

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;

  return {
    items: pageRows.map(toAdminUser),
    nextCursor: hasMore ? (pageRows.at(-1)?.createdAt.toISOString() ?? null) : null,
    hasMore,
  };
}

export async function updateUserRole(
  actor: Actor,
  targetUserId: string,
  input: AdminRoleUpdateBody,
) {
  const target = await repository.findUser(targetUserId);
  if (target === null) {
    throw new NotFoundError('Nie znaleziono tego użytkownika.', {
      code: ErrorCode.USER_NOT_FOUND,
    });
  }

  assertOutranks(actor, target.role);

  // Granting a role at or above one's own is escalation by another name.
  if (ROLE_RANK[input.role] >= ROLE_RANK[actor.role]) {
    throw new AuthorizationError('Nie możesz nadać roli równej lub wyższej od własnej.', {
      code: ErrorCode.INSUFFICIENT_ROLE,
    });
  }

  const updated = await repository.setRole(targetUserId, input.role);
  if (updated === null) throw new Error('Role update returned no row.');

  await repository.audit({
    action: 'change_user_role',
    actorUserId: actor.id,
    targetType: 'user',
    targetId: targetUserId,
    previousStatus: target.role,
    newStatus: input.role,
    reason: input.reason,
    metadata: { username: target.username },
  });

  return { id: updated.id, role: updated.role };
}

export async function sanctionUser(actor: Actor, targetUserId: string, input: AdminSanctionBody) {
  const target = await repository.findUser(targetUserId);
  if (target === null) {
    throw new NotFoundError('Nie znaleziono tego użytkownika.', {
      code: ErrorCode.USER_NOT_FOUND,
    });
  }

  assertOutranks(actor, target.role);

  // A permanent ban is a deliberate decision; a permanent *suspension* is
  // almost always a forgotten duration, so it is rejected rather than silently
  // treated as one.
  if (input.kind === 'suspension' && input.durationDays === undefined) {
    throw new ValidationError('Zawieszenie wymaga podania czasu trwania.', [
      { path: 'durationDays', message: 'Wymagane dla zawieszenia.' },
    ]);
  }

  const expiresAt =
    input.durationDays === undefined ? null : new Date(Date.now() + days(input.durationDays));

  const sanction = await repository.sanctionUser(targetUserId, actor.id, {
    kind: input.kind,
    reason: input.reason,
    expiresAt,
  });

  await repository.audit({
    action: 'sanction_user',
    actorUserId: actor.id,
    targetType: 'user',
    targetId: targetUserId,
    previousStatus: target.suspendedAt === null ? 'active' : 'suspended',
    newStatus: input.kind,
    reason: input.reason,
    metadata: {
      username: target.username,
      expiresAt: expiresAt?.toISOString() ?? null,
    },
  });

  return toAdminSanction({
    ...sanction,
    issuedByUsername: null,
    liftedByUsername: null,
  });
}

export async function liftUserSanctions(actor: Actor, targetUserId: string, reason: string) {
  const target = await repository.findUser(targetUserId);
  if (target === null) {
    throw new NotFoundError('Nie znaleziono tego użytkownika.', {
      code: ErrorCode.USER_NOT_FOUND,
    });
  }

  await repository.liftSanctions(targetUserId, actor.id);

  await repository.audit({
    action: 'lift_sanction',
    actorUserId: actor.id,
    targetType: 'user',
    targetId: targetUserId,
    previousStatus: 'suspended',
    newStatus: 'active',
    reason,
    metadata: { username: target.username },
  });

  return { success: true };
}

export async function listUserSanctions(targetUserId: string) {
  const rows = await repository.sanctions(targetUserId);
  return rows.map(toAdminSanction);
}

/* -------------------------------------------------------------------------- */
/* Catalogue                                                                   */
/* -------------------------------------------------------------------------- */

export async function listAnime(query: AdminSeriesQuery) {
  const limit = clampPageSize(query.limit);

  const rows = await repository.listAnime(
    { search: query.search, includeDeleted: asBoolean(query.includeDeleted) },
    limit,
    cursorDate(query.cursor),
  );

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;

  return {
    items: pageRows.map(toAdminAnime),
    nextCursor: hasMore ? (pageRows.at(-1)?.updatedAt.toISOString() ?? null) : null,
    hasMore,
  };
}

export async function updateAnime(actor: Actor, seriesId: string, input: AdminEntryUpdateBody) {
  const updated = await repository.updateMainEntry(seriesId, input);
  if (updated === null) {
    throw new NotFoundError('Nie znaleziono tego anime.', { code: ErrorCode.ANIME_NOT_FOUND });
  }

  await repository.audit({
    action: 'update_anime',
    actorUserId: actor.id,
    targetType: 'entry',
    targetId: updated.id,
    reason: 'catalogue_edit',
    // The changed fields are recorded so the log shows what was altered, not
    // merely that something was.
    metadata: { changed: Object.keys(input) },
  });

  return { id: seriesId };
}

/** Edits the series row itself — `isAdult`/`synopsis` — separate from `updateAnime`, which edits its main entry. */
export async function updateSeries(actor: Actor, seriesId: string, input: AdminSeriesUpdateBody) {
  const updated = await repository.updateSeries(seriesId, input);
  if (updated === null) {
    throw new NotFoundError('Nie znaleziono tego anime.', { code: ErrorCode.ANIME_NOT_FOUND });
  }

  await repository.audit({
    action: 'update_anime',
    actorUserId: actor.id,
    targetType: 'series',
    targetId: seriesId,
    reason: 'catalogue_edit',
    metadata: { changed: Object.keys(input) },
  });

  return { id: updated.id };
}

/** Hides or restores a title. Soft only: sources and library entries persist. */
export async function setAnimeVisibility(actor: Actor, animeId: string, deleted: boolean, reason: string) {
  const updated = await repository.setAnimeDeleted(animeId, deleted);
  if (updated === null) {
    throw new NotFoundError('Nie znaleziono tego anime.', { code: ErrorCode.ANIME_NOT_FOUND });
  }

  await repository.audit({
    action: deleted ? 'hide_anime' : 'restore_anime',
    actorUserId: actor.id,
    targetType: 'series',
    targetId: animeId,
    previousStatus: deleted ? 'visible' : 'hidden',
    newStatus: deleted ? 'hidden' : 'visible',
    reason,
  });

  return { id: updated.id, deleted };
}

/* -------------------------------------------------------------------------- */
/* Comments                                                                    */
/* -------------------------------------------------------------------------- */

export async function listComments(query: AdminCommentQuery) {
  const limit = clampPageSize(query.limit);

  const rows = await repository.listComments(
    { filter: query.filter ?? 'reported', search: query.search },
    limit,
    cursorDate(query.cursor),
  );

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;

  return {
    items: pageRows.map(toAdminComment),
    nextCursor: hasMore ? (pageRows.at(-1)?.createdAt.toISOString() ?? null) : null,
    hasMore,
  };
}

export async function moderateComment(
  actor: Actor,
  commentId: string,
  remove: boolean,
  reason: string,
) {
  const row = await repository.setCommentRemoved(commentId, actor.id, remove ? reason : null);
  if (row === null) {
    throw new NotFoundError('Nie znaleziono tego komentarza.');
  }

  await repository.audit({
    action: remove ? 'remove_comment' : 'restore_comment',
    actorUserId: actor.id,
    targetType: 'comment',
    targetId: commentId,
    previousStatus: remove ? 'visible' : 'removed',
    newStatus: remove ? 'removed' : 'visible',
    reason,
  });

  return { id: row.id, removed: remove };
}

/* -------------------------------------------------------------------------- */
/* Translator administration                                                   */
/* -------------------------------------------------------------------------- */

export async function setGroupVerified(actor: Actor, slug: string, verified: boolean, reason: string) {
  // `includeHidden`: a suspended group must still be reachable by staff, which
  // is the whole point of an administration surface.
  const group = await translatorRepository.findBySlug(slug, true);
  if (group === null) throw new NotFoundError('Nie znaleziono tej grupy.');

  // The change and its audit row are written together by the repository, so a
  // failed log cannot leave a verification nobody can account for.
  const updated = await translatorRepository.setVerified(group.id, actor.id, verified, {
    previousStatus: group.verifiedAt === null ? 'unverified' : 'verified',
    reason,
    name: group.name,
  });

  if (updated === null) throw new NotFoundError('Nie znaleziono tej grupy.');

  return { id: group.id, isVerified: verified };
}

export async function setGroupSuspended(
  actor: Actor,
  slug: string,
  suspended: boolean,
  reason: string,
) {
  const group = await translatorRepository.findBySlug(slug, true);
  if (group === null) throw new NotFoundError('Nie znaleziono tej grupy.');

  const updated = await translatorRepository.setSuspended(
    group.id,
    actor.id,
    suspended ? reason : null,
    {
      previousStatus: group.suspendedAt === null ? 'active' : 'suspended',
      reason,
      name: group.name,
    },
  );

  if (updated === null) throw new NotFoundError('Nie znaleziono tej grupy.');

  return { id: group.id, isSuspended: suspended };
}

/* -------------------------------------------------------------------------- */
/* Analytics                                                                   */
/* -------------------------------------------------------------------------- */

export async function getOverview(): Promise<AdminOverviewDto> {
  const now = Date.now();
  const since7 = new Date(now - days(7));
  const since30 = new Date(now - days(30));

  const [totals, groups, pendingApplications] = await Promise.all([
    repository.overview(since7, since30),
    translatorRepository.countGroups(),
    translatorRepository.countPendingApplications(),
  ]);

  return {
    users: {
      total: totals.totalUsers,
      newLast7Days: totals.new7,
      newLast30Days: totals.new30,
      suspended: totals.suspended,
    },
    catalogue: {
      anime: totals.seriesCount,
      episodes: totals.episodeCount,
      sources: totals.sourceCount,
    },
    moderation: {
      pendingSources: totals.pendingSources,
      openReports: totals.openReports,
      removedComments: totals.removedComments,
    },
    engagement: {
      comments: totals.commentCount,
      ratings: totals.ratingCount,
      libraryEntries: totals.libraryCount,
    },
    translators: { groups, pendingApplications },
    generatedAt: new Date().toISOString(),
  };
}

/** ISO date (YYYY-MM-DD) for a timestamp, in UTC. */
function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export async function getAnalytics(query: AdminAnalyticsQuery) {
  const parsed =
    typeof query.days === 'string' ? Number.parseInt(query.days, 10) : (query.days ?? 30);
  // Clamped rather than trusted: the contract bounds it, but an unbounded scan
  // is worth defending against in the one place that issues the query.
  const windowDays = Math.min(Math.max(Number.isFinite(parsed) ? parsed : 30, 1), 365);

  const to = new Date();
  const from = new Date(to.getTime() - days(windowDays));

  const [registrations, comments, sourceSubmissions, topAnime] = await Promise.all([
    repository.dailySeries('users', from, to),
    repository.dailySeries('comments', from, to),
    repository.dailySeries('sources', from, to),
    repository.topAnime(10),
  ]);

  return {
    registrations,
    comments,
    sourceSubmissions,
    topAnime: topAnime.map((row) => ({
      seriesId: row.seriesId,
      slug: row.slug,
      title: row.title,
      libraryCount: row.libraryCount,
      averageRating: row.averageRating === null ? null : Number(row.averageRating),
    })),
    from: isoDate(from),
    to: isoDate(to),
  };
}
