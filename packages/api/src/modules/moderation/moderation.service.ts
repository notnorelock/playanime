import { and, desc, eq, sql } from 'drizzle-orm';
import { NotFoundError, now, ErrorCode } from '@playanime/shared';
import {
  ModerationAction,
  SourceStatus,
  type ModerationDecisionRequest,
  type PendingSourceDto,
} from '@playanime/contracts';
import {
  anime,
  blockedResources,
  db,
  episodes,
  episodeSources,
  moderationAuditLog,
  reports,
  users,
  type Database,
} from '@playanime/database';

/**
 * Source moderation.
 *
 * Every decision is a status transition plus an audit row, written in one
 * transaction. If the audit write can fail independently of the state change,
 * the log stops being a reliable record — and an unreliable audit log is worse
 * than none, because it will be trusted.
 *
 * Nothing here deletes. A source taken down keeps its row and its history so a
 * later enquiry can be answered.
 */

/**
 * Which transitions each action performs, and whether it bars resubmission.
 *
 * Keyed by the literal action type rather than `string`, so the key is narrow
 * enough to insert into the `moderation_action` enum column without a cast.
 */
type SourceModerationAction =
  | typeof ModerationAction.APPROVE_SOURCE
  | typeof ModerationAction.REJECT_SOURCE
  | typeof ModerationAction.DISABLE_SOURCE
  | typeof ModerationAction.BLOCK_SOURCE
  | typeof ModerationAction.MARK_UNAVAILABLE
  | typeof ModerationAction.APPLY_COPYRIGHT_CLAIM
  | typeof ModerationAction.RESTORE_SOURCE;

const ACTION_TRANSITIONS: Readonly<
  Record<SourceModerationAction, { status: SourceStatus; disables: boolean; verifies?: boolean }>
> = {
  [ModerationAction.APPROVE_SOURCE]: { status: SourceStatus.ACTIVE, disables: false, verifies: true },
  [ModerationAction.REJECT_SOURCE]: { status: SourceStatus.REJECTED, disables: true },
  [ModerationAction.DISABLE_SOURCE]: { status: SourceStatus.DISABLED, disables: true },
  [ModerationAction.BLOCK_SOURCE]: { status: SourceStatus.BLOCKED, disables: true },
  [ModerationAction.MARK_UNAVAILABLE]: { status: SourceStatus.UNAVAILABLE, disables: false },
  [ModerationAction.APPLY_COPYRIGHT_CLAIM]: { status: SourceStatus.COPYRIGHT_CLAIM, disables: true },
  [ModerationAction.RESTORE_SOURCE]: { status: SourceStatus.ACTIVE, disables: false },
};

export async function listPendingSources(
  limit: number,
  database: Database = db(),
): Promise<PendingSourceDto[]> {
  const rows = await database
    .select({
      id: episodeSources.id,
      episodeId: episodeSources.episodeId,
      animeTitle: anime.titleRomaji,
      episodeNumber: episodes.number,
      provider: episodeSources.provider,
      originalUrl: episodeSources.originalUrl,
      normalizedUrl: episodeSources.canonicalUrl,
      status: episodeSources.status,
      submittedByUserId: episodeSources.submittedByUserId,
      submittedByUsername: users.username,
      rightsAttestedAt: episodeSources.rightsAttestedAt,
      note: episodeSources.submitterNote,
      createdAt: episodeSources.createdAt,
      openReportCount: sql<number>`(
        select count(*) from ${reports}
        where ${reports.targetId} = ${episodeSources.id}
          and ${reports.status} in ('open', 'under_review')
      )`.as('open_report_count'),
    })
    .from(episodeSources)
    .innerJoin(episodes, eq(episodes.id, episodeSources.episodeId))
    .innerJoin(anime, eq(anime.id, episodes.animeId))
    .leftJoin(users, eq(users.id, episodeSources.submittedByUserId))
    .where(eq(episodeSources.status, SourceStatus.PENDING))
    // Oldest first: a moderation queue worked newest-first starves old items.
    .orderBy(episodeSources.createdAt)
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    episodeId: row.episodeId,
    animeTitle: row.animeTitle,
    episodeNumber: row.episodeNumber,
    provider: row.provider,
    originalUrl: row.originalUrl,
    normalizedUrl: row.normalizedUrl,
    status: row.status,
    submittedByUserId: row.submittedByUserId,
    submittedByUsername: row.submittedByUsername,
    rightsAttestedAt: row.rightsAttestedAt?.toISOString() ?? null,
    note: row.note,
    openReportCount: row.openReportCount,
    createdAt: row.createdAt.toISOString(),
  }));
}

export interface ModerationContext {
  readonly actorUserId: string;
  readonly actorIpAddress: string;
  readonly reportId?: string | undefined;
}

/**
 * Applies a moderation decision to a source.
 *
 * The status change, the audit row, and any block-list entry are one
 * transaction: a decision is either fully recorded or not applied at all.
 */
export async function decideSource(
  sourceId: string,
  action: SourceModerationAction,
  decision: ModerationDecisionRequest,
  context: ModerationContext,
  database: Database = db(),
): Promise<{ id: string; status: SourceStatus }> {
  const transition = ACTION_TRANSITIONS[action];

  return database.transaction(async (tx) => {
    const [source] = await tx
      .select({
        id: episodeSources.id,
        status: episodeSources.status,
        provider: episodeSources.provider,
        externalId: episodeSources.externalId,
      })
      .from(episodeSources)
      .where(eq(episodeSources.id, sourceId))
      .limit(1);

    if (source === undefined) {
      throw new NotFoundError('Nie znaleziono tego źródła.', { code: ErrorCode.SOURCE_NOT_FOUND });
    }

    await tx
      .update(episodeSources)
      .set({
        status: transition.status,
        disabledAt: transition.disables ? now() : null,
        ...(transition.verifies === true ? { isVerified: true } : {}),
      })
      .where(eq(episodeSources.id, sourceId));

    // A blocked or copyright-claimed resource is added to the block list, so it
    // cannot be resubmitted against a different episode.
    if (
      transition.status === SourceStatus.BLOCKED ||
      transition.status === SourceStatus.COPYRIGHT_CLAIM
    ) {
      await tx
        .insert(blockedResources)
        .values({
          provider: source.provider,
          externalId: source.externalId,
          reason: decision.reason,
          blockedByUserId: context.actorUserId,
        })
        .onConflictDoNothing();
    }

    await tx.insert(moderationAuditLog).values({
      action,
      actorUserId: context.actorUserId,
      targetType: 'episode_source',
      targetId: sourceId,
      previousStatus: source.status,
      newStatus: transition.status,
      reason: decision.reason,
      reportId: context.reportId ?? null,
      actorIpAddress: context.actorIpAddress,
      metadata: {
        internalNote: decision.internalNote ?? null,
        notifySubmitter: decision.notifySubmitter ?? false,
      },
    });

    return { id: sourceId, status: transition.status };
  });
}

/** Audit history for one object, newest first. */
export async function auditTrail(
  targetType: string,
  targetId: string,
  database: Database = db(),
): Promise<
  {
    id: string;
    action: string;
    actorUsername: string | null;
    previousStatus: string | null;
    newStatus: string | null;
    reason: string | null;
    createdAt: string;
  }[]
> {
  const rows = await database
    .select({
      id: moderationAuditLog.id,
      action: moderationAuditLog.action,
      actorUsername: users.username,
      previousStatus: moderationAuditLog.previousStatus,
      newStatus: moderationAuditLog.newStatus,
      reason: moderationAuditLog.reason,
      createdAt: moderationAuditLog.createdAt,
    })
    .from(moderationAuditLog)
    .leftJoin(users, eq(users.id, moderationAuditLog.actorUserId))
    .where(
      and(eq(moderationAuditLog.targetType, targetType), eq(moderationAuditLog.targetId, targetId)),
    )
    .orderBy(desc(moderationAuditLog.createdAt));

  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    actorUsername: row.actorUsername,
    previousStatus: row.previousStatus,
    newStatus: row.newStatus,
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
  }));
}
