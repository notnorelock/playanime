import { and, eq, inArray } from 'drizzle-orm';
import { NotFoundError, ConflictError, ErrorCode, now } from '@playanime/shared';
import {
  ModerationAction,
  ReportStatus,
  ReportTargetType,
  type ReportDecisionRequest,
  type ReportTargetType as ReportTargetTypeValue,
  type PendingReportDto,
} from '@playanime/contracts';
import {
  TranslatorRepository,
  blockedTitles,
  db,
  entries,
  mediaAssets,
  moderationAuditLog,
  notifications,
  reports,
  series,
  users,
  type Database,
} from '@playanime/database';
import { renderTakedownResolutionEmail, sendEmail } from '@playanime/email';
import { logger } from '../../plugins/error-handler.js';
import { invalidateAnimeCaches } from '../catalogue/cache.js';

const translatorRepository = new TranslatorRepository(db());

/**
 * Report review — the takedown queue.
 *
 * Only `ReportTargetType.ANIME` has an actual approval effect today (hiding
 * the title and blocking its AniList/MAL id from resubmission). Every other
 * target type can still be dismissed, since `reports` covers more than
 * takedowns, but approving one is a no-op on the catalogue — there is
 * nothing yet for a comment/review/user/episode-source report to *do* beyond
 * record the decision. Episode-source complaints already have their own,
 * more capable action (`ModerationAction.APPLY_COPYRIGHT_CLAIM` in
 * `moderation.service.ts`) and are expected to be handled there instead.
 *
 * Every decision — the catalogue write when there is one, the report's own
 * status update, and the audit row — is one transaction, mirroring
 * `moderation.service.ts`'s `decideSource`. Notifying the uploading group
 * and emailing the reporter both happen after the transaction commits,
 * fire-and-forget: neither should be able to roll back a moderator's
 * decision, matching how `translateUntranslatedTaxonomy` treats DeepL.
 */

export interface ReportModerationContext {
  readonly actorUserId: string;
  readonly actorIpAddress: string;
}

export async function listPendingReports(
  targetType: ReportTargetTypeValue | undefined,
  limit: number,
  database: Database = db(),
): Promise<PendingReportDto[]> {
  const rows = await database
    .select({
      id: reports.id,
      reference: reports.reference,
      type: reports.type,
      targetType: reports.targetType,
      targetId: reports.targetId,
      animeTitle: series.title,
      animePosterUrl: mediaAssets.url,
      reporterUserId: reports.reporterUserId,
      reporterUsername: users.username,
      reporterName: reports.reporterName,
      reporterEmail: reports.reporterEmail,
      reason: reports.reason,
      description: reports.description,
      rightsHolderAttestedAt: reports.rightsHolderAttestedAt,
      status: reports.status,
      createdAt: reports.createdAt,
    })
    .from(reports)
    .leftJoin(users, eq(users.id, reports.reporterUserId))
    // Only resolves for an anime-targeted report; harmless left join miss otherwise.
    .leftJoin(series, and(eq(reports.targetType, ReportTargetType.ANIME), eq(series.id, reports.targetId)))
    .leftJoin(
      mediaAssets,
      and(eq(mediaAssets.seriesId, series.id), eq(mediaAssets.kind, 'poster'), eq(mediaAssets.isPrimary, true)),
    )
    .where(
      and(
        targetType === undefined ? undefined : eq(reports.targetType, targetType),
        inArray(reports.status, [ReportStatus.OPEN, ReportStatus.UNDER_REVIEW]),
      ),
    )
    .orderBy(reports.createdAt)
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    reference: row.reference,
    type: row.type,
    targetType: row.targetType,
    targetId: row.targetId,
    animeTitle: row.animeTitle,
    animePosterUrl: row.animePosterUrl,
    reporterUserId: row.reporterUserId,
    reporterUsername: row.reporterUsername,
    reporterName: row.reporterName,
    reporterEmail: row.reporterEmail,
    reason: row.reason,
    description: row.description,
    rightsHolderAttestedAt: row.rightsHolderAttestedAt?.toISOString() ?? null,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  }));
}

export interface DecideReportResult {
  readonly id: string;
  readonly status: ReportStatus;
}

interface DecideReportOutcome {
  readonly result: DecideReportResult;
  readonly ownerGroupId: string | null;
  readonly reporterAddress: string | null;
  readonly titleName: string;
  readonly reference: string;
}

export async function decideReport(
  reportId: string,
  decision: ReportDecisionRequest,
  context: ReportModerationContext,
  database: Database = db(),
): Promise<DecideReportResult> {
  const newStatus = decision.approve ? ReportStatus.ACTION_TAKEN : ReportStatus.DISMISSED;

  const outcome = await database.transaction(async (tx): Promise<DecideReportOutcome> => {
    const [report] = await tx.select().from(reports).where(eq(reports.id, reportId)).limit(1);

    if (report === undefined) {
      throw new NotFoundError('Nie znaleziono tego zgłoszenia.');
    }
    if (report.status !== ReportStatus.OPEN && report.status !== ReportStatus.UNDER_REVIEW) {
      throw new ConflictError('To zgłoszenie zostało już rozpatrzone.', { code: ErrorCode.CONFLICT });
    }

    let reporterAddress = report.reporterUserId === null ? report.reporterEmail : null;
    if (report.reporterUserId !== null) {
      const [reporter] = await tx
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, report.reporterUserId))
        .limit(1);
      reporterAddress = reporter?.email ?? null;
    }

    let previousStatus: string | null = null;
    let newAnimeStatus: string | null = null;
    let ownerGroupId: string | null = null;
    let titleName = '';

    if (decision.approve && report.targetType === ReportTargetType.ANIME) {
      const [title] = await tx
        .select({ id: series.id, slug: series.slug, title: series.title, deletedAt: series.deletedAt })
        .from(series)
        .where(eq(series.id, report.targetId))
        .limit(1);

      if (title === undefined) {
        throw new NotFoundError('Zgłoszony tytuł już nie istnieje.');
      }

      const seriesEntries = await tx
        .select({
          anilistId: entries.anilistId,
          malId: entries.malId,
          createdByGroupId: entries.createdByGroupId,
          isMainEntry: entries.isMainEntry,
        })
        .from(entries)
        .where(eq(entries.seriesId, title.id));

      titleName = title.title;
      previousStatus = title.deletedAt === null ? 'visible' : 'hidden';
      newAnimeStatus = 'hidden';

      // Every entry under the series is taken down together — a takedown
      // is against the whole title, not one season/movie/OVA of it.
      await tx.update(series).set({ deletedAt: now() }).where(eq(series.id, title.id));
      await tx.update(entries).set({ deletedAt: now() }).where(eq(entries.seriesId, title.id));

      for (const entry of seriesEntries) {
        if (entry.anilistId === null && entry.malId === null) continue;
        await tx
          .insert(blockedTitles)
          .values({
            anilistId: entry.anilistId,
            malId: entry.malId,
            reason: decision.reason,
            reportId: report.id,
            blockedByUserId: context.actorUserId,
          })
          .onConflictDoNothing();
      }

      ownerGroupId = seriesEntries.find((entry) => entry.isMainEntry)?.createdByGroupId ?? seriesEntries[0]?.createdByGroupId ?? null;
    } else if (report.targetType === ReportTargetType.ANIME) {
      const [title] = await tx
        .select({ title: series.title })
        .from(series)
        .where(eq(series.id, report.targetId))
        .limit(1);
      titleName = title?.title ?? 'tytułu';
    }

    await tx
      .update(reports)
      .set({
        status: newStatus,
        reviewedAt: now(),
        reviewedByUserId: context.actorUserId,
        resolution: decision.resolution ?? null,
        internalNote: decision.internalNote ?? null,
      })
      .where(eq(reports.id, reportId));

    await tx.insert(moderationAuditLog).values({
      action: decision.approve ? ModerationAction.TAKEDOWN_ANIME : ModerationAction.DISMISS_REPORT,
      actorUserId: context.actorUserId,
      targetType: report.targetType,
      targetId: report.targetId,
      previousStatus,
      newStatus: newAnimeStatus,
      reason: decision.reason,
      reportId: report.id,
      actorIpAddress: context.actorIpAddress,
      metadata: { internalNote: decision.internalNote ?? null },
    });

    return {
      result: { id: reportId, status: newStatus },
      ownerGroupId,
      reporterAddress,
      titleName,
      reference: report.reference,
    };
  });

  if (decision.approve) await invalidateAnimeCaches();

  if (outcome.ownerGroupId !== null) {
    const leaderUserIds = await translatorRepository.leaderUserIds(outcome.ownerGroupId);
    if (leaderUserIds.length > 0) {
      await database.insert(notifications).values(
        leaderUserIds.map((userId) => ({
          userId,
          actorUserId: context.actorUserId,
          kind: 'moderation' as const,
          title: 'Tytuł usunięty na skutek zgłoszenia',
          body: `„${outcome.titleName}” został usunięty z katalogu po zweryfikowaniu zgłoszenia ${outcome.reference}.`,
          href: '/admin/dashboard',
        })),
      );
    }
  }

  if (outcome.reporterAddress !== null) {
    const { subject, html, text } = renderTakedownResolutionEmail({
      reference: outcome.reference,
      titleName: outcome.titleName,
      approved: decision.approve,
      resolution: decision.resolution ?? null,
    });

    try {
      await sendEmail({ to: outcome.reporterAddress, subject, html, text }, logger);
    } catch (cause: unknown) {
      logger.error('Failed to send takedown resolution email', cause, { module: 'reports' });
    }
  }

  return outcome.result;
}
