import { Type, type Static } from '@sinclair/typebox';
import { IsoDateTime, literalUnion, Uuid } from '../common/index.js';
import { SOURCE_STATUSES } from '../media/sources.js';

/**
 * Reportable content categories.
 *
 * `COPYRIGHT` is deliberately separate from generic abuse: it routes to a
 * different queue, permits anonymous submission with contact details, and
 * triggers the takedown workflow rather than ordinary moderation.
 */
export const ReportType = {
  COPYRIGHT: 'copyright',
  SOURCE_UNAVAILABLE: 'source_unavailable',
  WRONG_EPISODE: 'wrong_episode',
  MALICIOUS_SOURCE: 'malicious_source',
  MISLEADING_METADATA: 'misleading_metadata',
  INAPPROPRIATE_COMMENT: 'inappropriate_comment',
  OTHER: 'other',
} as const;
export type ReportType = (typeof ReportType)[keyof typeof ReportType];
export const REPORT_TYPES = Object.values(ReportType);

export const ReportTargetType = {
  EPISODE_SOURCE: 'episode_source',
  COMMENT: 'comment',
  REVIEW: 'review',
  USER: 'user',
  ANIME: 'anime',
} as const;
export type ReportTargetType = (typeof ReportTargetType)[keyof typeof ReportTargetType];
export const REPORT_TARGET_TYPES = Object.values(ReportTargetType);

export const ReportStatus = {
  OPEN: 'open',
  UNDER_REVIEW: 'under_review',
  ACTION_TAKEN: 'action_taken',
  DISMISSED: 'dismissed',
} as const;
export type ReportStatus = (typeof ReportStatus)[keyof typeof ReportStatus];
export const REPORT_STATUSES = Object.values(ReportStatus);

/**
 * Report submission.
 *
 * Anonymous submission is supported because a rights holder is frequently not
 * a registered user. When unauthenticated, `reporterEmail` is required so the
 * complaint can be acknowledged — enforced by the API, since JSON Schema cannot
 * express a conditional that depends on the session.
 */
export const ReportSubmissionRequest = Type.Object({
  type: literalUnion(REPORT_TYPES),
  targetType: literalUnion(REPORT_TARGET_TYPES),
  targetId: Uuid,
  reason: Type.String({ minLength: 1, maxLength: 200 }),
  description: Type.Optional(Type.String({ maxLength: 5000 })),
  /** Required for anonymous reports; ignored when authenticated. */
  reporterEmail: Type.Optional(Type.String({ format: 'email', maxLength: 254 })),
  /**
   * Copyright complaints only: affirmation of good-faith belief and authority
   * to act for the rights holder. Stored with the complaint.
   */
  rightsHolderAttested: Type.Optional(Type.Boolean()),
  contactName: Type.Optional(Type.String({ maxLength: 200 })),
});
export type ReportSubmissionRequest = Static<typeof ReportSubmissionRequest>;

export const ReportSubmissionResponse = Type.Object({
  id: Uuid,
  status: literalUnion(REPORT_STATUSES),
  /** Short public reference the reporter can quote in correspondence. */
  reference: Type.String(),
  message: Type.String(),
});
export type ReportSubmissionResponse = Static<typeof ReportSubmissionResponse>;

/* -------------------------------------------------------------------------- */
/* Moderation                                                                  */
/* -------------------------------------------------------------------------- */

/** Moderation verbs. Each maps to exactly one audited status transition. */
export const ModerationAction = {
  APPROVE_SOURCE: 'approve_source',
  REJECT_SOURCE: 'reject_source',
  DISABLE_SOURCE: 'disable_source',
  BLOCK_SOURCE: 'block_source',
  RESTORE_SOURCE: 'restore_source',
  MARK_UNAVAILABLE: 'mark_unavailable',
  APPLY_COPYRIGHT_CLAIM: 'apply_copyright_claim',
  REMOVE_COMMENT: 'remove_comment',
  RESOLVE_REPORT: 'resolve_report',
  DISMISS_REPORT: 'dismiss_report',
  BLOCK_DOMAIN: 'block_domain',
  SANCTION_USER: 'sanction_user',
  LIFT_SANCTION: 'lift_sanction',
  CHANGE_USER_ROLE: 'change_user_role',
  UPDATE_ANIME: 'update_anime',
  UPDATE_EPISODE: 'update_episode',
  PROPOSE_CATALOGUE_EDIT: 'propose_catalogue_edit',
  APPROVE_CATALOGUE_EDIT: 'approve_catalogue_edit',
  REJECT_CATALOGUE_EDIT: 'reject_catalogue_edit',
  HIDE_ANIME: 'hide_anime',
  RESTORE_ANIME: 'restore_anime',
  TAKEDOWN_ANIME: 'takedown_anime',
  DELETE_ANIME: 'delete_anime',
  RESTORE_COMMENT: 'restore_comment',
  VERIFY_TRANSLATOR_GROUP: 'verify_translator_group',
  SUSPEND_TRANSLATOR_GROUP: 'suspend_translator_group',
} as const;
export type ModerationAction = (typeof ModerationAction)[keyof typeof ModerationAction];
export const MODERATION_ACTIONS = Object.values(ModerationAction);

/** Every moderation endpoint takes a reason. Audit rows are never reasonless. */
export const ModerationDecisionRequest = Type.Object({
  reason: Type.String({ minLength: 1, maxLength: 1000 }),
  /** Internal note, never shown to the submitting user. */
  internalNote: Type.Optional(Type.String({ maxLength: 2000 })),
  /** Notify the submitter of this decision where appropriate. */
  notifySubmitter: Type.Optional(Type.Boolean()),
});
export type ModerationDecisionRequest = Static<typeof ModerationDecisionRequest>;

/** A pending source as the moderation queue shows it, with submitter identity. */
export const PendingSourceDto = Type.Object({
  id: Uuid,
  episodeId: Uuid,
  animeTitle: Type.String(),
  episodeNumber: Type.Integer(),
  provider: Type.String(),
  originalUrl: Type.String(),
  normalizedUrl: Type.String(),
  status: literalUnion(SOURCE_STATUSES),
  submittedByUserId: Type.Union([Uuid, Type.Null()]),
  submittedByUsername: Type.Union([Type.String(), Type.Null()]),
  rightsAttestedAt: Type.Union([IsoDateTime, Type.Null()]),
  note: Type.Union([Type.String(), Type.Null()]),
  openReportCount: Type.Integer({ minimum: 0 }),
  createdAt: IsoDateTime,
});
export type PendingSourceDto = Static<typeof PendingSourceDto>;

/**
 * A pending report as the takedown/moderation queue shows it.
 *
 * `targetType`/`targetId` stay generic since `reports` covers more than
 * anime, but `animeTitle`/`animePosterUrl` are populated whenever the target
 * resolves to a title (the only kind this queue currently acts on) so the
 * queue can render without a second lookup per row.
 */
export const PendingReportDto = Type.Object({
  id: Uuid,
  reference: Type.String(),
  type: literalUnion(REPORT_TYPES),
  targetType: literalUnion(REPORT_TARGET_TYPES),
  targetId: Uuid,
  animeTitle: Type.Union([Type.String(), Type.Null()]),
  animePosterUrl: Type.Union([Type.String(), Type.Null()]),
  reporterUserId: Type.Union([Uuid, Type.Null()]),
  reporterUsername: Type.Union([Type.String(), Type.Null()]),
  reporterName: Type.Union([Type.String(), Type.Null()]),
  reporterEmail: Type.Union([Type.String(), Type.Null()]),
  reason: Type.String(),
  description: Type.Union([Type.String(), Type.Null()]),
  rightsHolderAttestedAt: Type.Union([IsoDateTime, Type.Null()]),
  status: literalUnion(REPORT_STATUSES),
  createdAt: IsoDateTime,
});
export type PendingReportDto = Static<typeof PendingReportDto>;

/** A moderator's decision on a report — approve acts on the target, reject dismisses it. */
export const ReportDecisionRequest = Type.Object({
  approve: Type.Boolean(),
  /** Internal justification. Always required, mirrors every other moderation decision. */
  reason: Type.String({ minLength: 1, maxLength: 1000 }),
  /** Shown to the reporter, e.g. in the resolution email. */
  resolution: Type.Optional(Type.String({ maxLength: 2000 })),
  /** Never shown outside the moderation team. */
  internalNote: Type.Optional(Type.String({ maxLength: 2000 })),
});
export type ReportDecisionRequest = Static<typeof ReportDecisionRequest>;

export const AuditLogEntryDto = Type.Object({
  id: Uuid,
  action: literalUnion(MODERATION_ACTIONS),
  actorUserId: Type.Union([Uuid, Type.Null()]),
  actorUsername: Type.Union([Type.String(), Type.Null()]),
  targetType: Type.String(),
  targetId: Uuid,
  reason: Type.Union([Type.String(), Type.Null()]),
  previousStatus: Type.Union([Type.String(), Type.Null()]),
  newStatus: Type.Union([Type.String(), Type.Null()]),
  createdAt: IsoDateTime,
});
export type AuditLogEntryDto = Static<typeof AuditLogEntryDto>;
