import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { NotFoundError } from '@playanime/shared';
import {
  AdminRepository,
  db,
  entries,
  episodeCredits,
  episodeReports,
  episodes,
  notifications,
  TranslatorRepository,
  userPreferences,
  users,
  type Database,
} from '@playanime/database';
import type {
  EpisodeReportCreateResponse,
  EpisodeReportDto,
  EpisodeReportReason,
  EpisodeReportStatus,
} from '@playanime/contracts';
import { renderEpisodeReportReplyEmail, sendEmail } from '@playanime/email';
import { logger } from '../../plugins/error-handler.js';

/**
 * "Report episode" — see `packages/contracts/src/episode-reports/index.ts`
 * for the full design rationale and why this is separate from the general
 * `reports` system.
 *
 * No repository class, matching `contact`/`support`/`blog`/`announcements`/
 * `pages`'s own modules: a small table with no cross-module read pattern
 * anything else needs.
 */

const adminRepository = new AdminRepository(db());
const translatorRepository = new TranslatorRepository(db());

const rowColumns = {
  id: episodeReports.id,
  episodeId: episodeReports.episodeId,
  animeTitle: entries.titleRomaji,
  episodeNumber: episodes.number,
  reason: episodeReports.reason,
  description: episodeReports.description,
  status: episodeReports.status,
  reporterUsername: users.username,
  replyText: episodeReports.replyText,
  createdAt: episodeReports.createdAt,
};

/** Distinct groups credited on an episode — the "who contributed" set a report is routed to. */
async function contributingGroupIds(episodeId: string, database: Database): Promise<string[]> {
  const rows = await database
    .selectDistinct({ groupId: episodeCredits.groupId })
    .from(episodeCredits)
    .where(and(eq(episodeCredits.episodeId, episodeId), isNotNull(episodeCredits.groupId)));

  return rows.map((row) => row.groupId).filter((groupId): groupId is string => groupId !== null);
}

function toDto(row: {
  id: string;
  episodeId: string;
  animeTitle: string;
  episodeNumber: number;
  reason: EpisodeReportReason;
  description: string | null;
  status: EpisodeReportStatus;
  reporterUsername: string;
  replyText: string | null;
  createdAt: Date;
}): EpisodeReportDto {
  return {
    id: row.id,
    episodeId: row.episodeId,
    animeTitle: row.animeTitle,
    episodeNumber: row.episodeNumber,
    reason: row.reason,
    description: row.description,
    status: row.status,
    reporterUsername: row.reporterUsername,
    replyText: row.replyText,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Submits a new report for one episode. Any logged-in user may report the
 * same episode more than once — no uniqueness constraint, since a second
 * report may describe a different problem.
 *
 * Notifies (in-app) every group credited on the episode, not only platform
 * staff — a broken episode is usually the credited group's own release, and
 * they are best placed to confirm/fix it, same as they already see it in
 * the episode's own credits panel. Staff still see every report in the
 * admin queue regardless.
 */
export async function submitEpisodeReport(
  reporterUserId: string,
  input: { episodeId: string; reason: EpisodeReportReason; description?: string },
  database: Database = db(),
): Promise<EpisodeReportCreateResponse> {
  const [episode] = await database
    .select({ id: episodes.id, number: episodes.number, entryTitle: entries.titleRomaji })
    .from(episodes)
    .innerJoin(entries, eq(entries.id, episodes.entryId))
    .where(eq(episodes.id, input.episodeId))
    .limit(1);

  if (episode === undefined) {
    throw new NotFoundError('Nie znaleziono tego odcinka.');
  }

  const [created] = await database
    .insert(episodeReports)
    .values({
      episodeId: input.episodeId,
      reporterUserId,
      reason: input.reason,
      description: input.description ?? null,
    })
    .returning({ id: episodeReports.id });

  if (created === undefined) throw new Error('Episode report insert returned no row.');

  const groupIds = await contributingGroupIds(input.episodeId, database);

  const leaderUserIds = new Set<string>();
  for (const groupId of groupIds) {
    for (const userId of await translatorRepository.leaderUserIds(groupId)) leaderUserIds.add(userId);
  }

  if (leaderUserIds.size > 0) {
    await database.insert(notifications).values(
      [...leaderUserIds].map((userId) => ({
        userId,
        actorUserId: reporterUserId,
        kind: 'moderation' as const,
        title: 'Zgłoszono problem z odcinkiem',
        body: `„${episode.entryTitle}”, odcinek ${String(episode.number)} został zgłoszony jako uszkodzony.`,
        href: '/admin/dashboard',
      })),
    );
  }

  return { id: created.id, message: 'Zgłoszenie zostało wysłane. Dziękujemy!' };
}

/** Staff queue — every report, optionally filtered by status, newest first. */
export async function listEpisodeReports(
  status: EpisodeReportStatus | undefined,
  limit: number,
  database: Database = db(),
): Promise<EpisodeReportDto[]> {
  const rows = await database
    .select(rowColumns)
    .from(episodeReports)
    .innerJoin(episodes, eq(episodes.id, episodeReports.episodeId))
    .innerJoin(entries, eq(entries.id, episodes.entryId))
    .innerJoin(users, eq(users.id, episodeReports.reporterUserId))
    .where(status === undefined ? undefined : eq(episodeReports.status, status))
    .orderBy(desc(episodeReports.createdAt))
    .limit(limit);

  return rows.map(toDto);
}

/**
 * A group leader's own queue — only reports for episodes their group is
 * credited on. Unlike the staff queue, not filterable by arbitrary status
 * (a group has few enough of its own reports that the distinction matters
 * less), always newest first.
 */
export async function listEpisodeReportsForGroup(
  groupId: string,
  limit: number,
  database: Database = db(),
): Promise<EpisodeReportDto[]> {
  const rows = await database
    .select(rowColumns)
    .from(episodeReports)
    .innerJoin(episodes, eq(episodes.id, episodeReports.episodeId))
    .innerJoin(entries, eq(entries.id, episodes.entryId))
    .innerJoin(users, eq(users.id, episodeReports.reporterUserId))
    .innerJoin(episodeCredits, eq(episodeCredits.episodeId, episodeReports.episodeId))
    .where(eq(episodeCredits.groupId, groupId))
    .orderBy(desc(episodeReports.createdAt))
    .limit(limit);

  // A group can be credited on an episode more than once (different roles),
  // so the join above can repeat a report — de-duplicate by id rather than
  // adding a second `selectDistinct` query.
  const seen = new Set<string>();
  const deduped = rows.filter((row) => {
    if (seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });
  return deduped.map(toDto);
}

export interface ResolveContext {
  readonly actorUserId: string;
  /** Set only for a group-leader resolving their own group's report — the service still re-verifies the episode is actually one their group contributed to. */
  readonly asGroupId?: string;
}

/**
 * Resolves a report: records the status/reply, then emails the reporter —
 * mirroring `reports.service.ts`'s takedown-resolution email (recorded
 * first, so a transient send failure never loses track of the decision;
 * the send itself is best-effort and its failure is logged, not thrown,
 * since the report is already correctly resolved either way).
 *
 * When `context.asGroupId` is set (a group leader, not platform staff),
 * re-verifies group membership on the episode here rather than trusting the
 * controller alone — the same defense-in-depth this codebase's other
 * privileged actions use (see `add-privileged-action`).
 */
export async function resolveEpisodeReport(
  reportId: string,
  input: { status: 'action_taken' | 'dismissed'; replyText?: string },
  context: ResolveContext,
  database: Database = db(),
): Promise<EpisodeReportDto> {
  const [existing] = await database
    .select({
      id: episodeReports.id,
      episodeId: episodeReports.episodeId,
      reporterUserId: episodeReports.reporterUserId,
    })
    .from(episodeReports)
    .where(eq(episodeReports.id, reportId))
    .limit(1);

  if (existing === undefined) {
    throw new NotFoundError('Nie znaleziono tego zgłoszenia.');
  }

  if (context.asGroupId !== undefined) {
    const groupIds = await contributingGroupIds(existing.episodeId, database);
    if (!groupIds.includes(context.asGroupId)) {
      throw new NotFoundError('Nie znaleziono tego zgłoszenia.');
    }
  }

  const replyText = input.replyText ?? null;

  await database
    .update(episodeReports)
    .set({
      status: input.status,
      replyText,
      resolvedByUserId: context.actorUserId,
      resolvedAt: new Date(),
    })
    .where(eq(episodeReports.id, reportId));

  await adminRepository.audit({
    action: 'resolve_episode_report',
    actorUserId: context.actorUserId,
    targetType: 'episode_report',
    targetId: reportId,
    newStatus: input.status,
    reason: null,
    ...(context.asGroupId === undefined ? {} : { metadata: { asGroupId: context.asGroupId } }),
  });

  const [row] = await database
    .select(rowColumns)
    .from(episodeReports)
    .innerJoin(episodes, eq(episodes.id, episodeReports.episodeId))
    .innerJoin(entries, eq(entries.id, episodes.entryId))
    .innerJoin(users, eq(users.id, episodeReports.reporterUserId))
    .where(eq(episodeReports.id, reportId))
    .limit(1);

  if (row === undefined) throw new Error('Episode report vanished after resolution.');

  const [reporter] = await database
    .select({ email: users.email, emailNotifications: userPreferences.emailNotifications })
    .from(users)
    .leftJoin(userPreferences, eq(userPreferences.userId, users.id))
    .where(eq(users.id, existing.reporterUserId))
    .limit(1);

  if (reporter !== undefined && reporter.emailNotifications !== false) {
    try {
      const { subject, html, text } = renderEpisodeReportReplyEmail({
        animeTitle: row.animeTitle,
        episodeNumber: row.episodeNumber,
        status: input.status,
        replyText,
      });
      await sendEmail({ to: reporter.email, subject, html, text }, logger);
    } catch (cause: unknown) {
      logger.error('Failed to send episode report resolution email', cause, { module: 'episode-reports' });
    }
  }

  return toDto(row);
}
