import { relations, sql } from 'drizzle-orm';
import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import {
  createdAt,
  fk,
  moderationActionEnum,
  primaryId,
  reportStatusEnum,
  reportTargetTypeEnum,
  reportTypeEnum,
  timestamps,
} from './_shared.js';
import { users } from './users.js';

/**
 * Content reports.
 *
 * Anonymous reporting is supported deliberately: a rights holder is usually not
 * a registered user, and requiring an account before a copyright complaint can
 * be filed would make the takedown path unusable for the people who most need
 * it.
 */
export const reports = pgTable(
  'reports',
  {
    id: primaryId(),

    /** Short public reference the reporter can quote, e.g. `RPT-7K2M9X`. */
    reference: varchar('reference', { length: 24 }).notNull(),

    type: reportTypeEnum('type').notNull(),
    targetType: reportTargetTypeEnum('target_type').notNull(),
    /**
     * Polymorphic target. Intentionally without a foreign key: a report must
     * survive deletion of what it describes, otherwise resolving a complaint
     * would erase the evidence for it.
     */
    targetId: fk('target_id').notNull(),

    reporterUserId: fk('reporter_user_id').references(() => users.id, { onDelete: 'set null' }),
    /** Required for anonymous reports so the complaint can be acknowledged. */
    reporterEmail: varchar('reporter_email', { length: 254 }),
    reporterName: varchar('reporter_name', { length: 200 }),
    reporterIpAddress: varchar('reporter_ip_address', { length: 45 }),

    reason: varchar('reason', { length: 200 }).notNull(),
    description: text('description'),

    /**
     * Copyright complaints: affirmation of good-faith belief and authority to
     * act for the rights holder, with the time it was given.
     */
    rightsHolderAttestedAt: timestamp('rights_holder_attested_at', {
      withTimezone: true,
      mode: 'date',
    }),

    status: reportStatusEnum('status').notNull().default('open'),

    reviewedAt: timestamp('reviewed_at', { withTimezone: true, mode: 'date' }),
    reviewedByUserId: fk('reviewed_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    /** What was decided and why. Shown to the reporter where appropriate. */
    resolution: text('resolution'),
    /** Never shown outside the moderation team. */
    internalNote: text('internal_note'),

    ...timestamps(),
  },
  (table) => [
    uniqueIndex('reports_reference_key').on(table.reference),

    // The moderation queue: open reports, oldest first.
    index('reports_open_idx').on(table.createdAt).where(sql`${table.status} = 'open'`),

    // "How many open reports against this source?" — drives queue priority.
    index('reports_target_idx').on(table.targetType, table.targetId, table.status),

    // Copyright complaints route to a separate queue with tighter SLAs.
    index('reports_copyright_idx')
      .on(table.createdAt)
      .where(sql`${table.type} = 'copyright' and ${table.status} in ('open', 'under_review')`),

    index('reports_reporter_idx').on(table.reporterUserId),
  ],
);

/**
 * Moderation audit log.
 *
 * Append-only. Every state change a moderator makes lands here with the actor,
 * the reason, and the before/after status. This is what makes it possible to
 * answer "why is this source disabled, and who decided that?" months later.
 *
 * There is no update or delete path in the repository layer by design.
 */
export const moderationAuditLog = pgTable(
  'moderation_audit_log',
  {
    id: primaryId(),

    action: moderationActionEnum('action').notNull(),

    /** Null when the action was taken by an automated worker rather than a person. */
    actorUserId: fk('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    /** Distinguishes an automated decision from an absent user. */
    actorSystem: varchar('actor_system', { length: 64 }),

    targetType: varchar('target_type', { length: 32 }).notNull(),
    targetId: fk('target_id').notNull(),

    previousStatus: varchar('previous_status', { length: 32 }),
    newStatus: varchar('new_status', { length: 32 }),

    reason: text('reason'),
    /** Related report, when the action came from one. */
    reportId: fk('report_id').references(() => reports.id, { onDelete: 'set null' }),

    /**
     * Additional structured context — never signed URLs, never credentials.
     * This log is read by moderators and may be exported in legal responses.
     */
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),

    actorIpAddress: varchar('actor_ip_address', { length: 45 }),

    createdAt: createdAt(),
  },
  (table) => [
    // The history of one object, newest first.
    index('moderation_audit_target_idx').on(table.targetType, table.targetId, sql`${table.createdAt} desc`),
    // One moderator's activity, for oversight.
    index('moderation_audit_actor_idx').on(table.actorUserId, sql`${table.createdAt} desc`),
    index('moderation_audit_action_idx').on(table.action, table.createdAt),
  ],
);

/**
 * User sanctions.
 *
 * Separate from the suspension columns on `users` because a user accumulates a
 * history of sanctions, and the current state is derived from it. The columns
 * on `users` are the fast-path cache read during authentication.
 */
export const userSanctions = pgTable(
  'user_sanctions',
  {
    id: primaryId(),
    userId: fk('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    /** `warning` | `mute` | `suspension` | `ban`. */
    kind: varchar('kind', { length: 32 }).notNull(),

    reason: text('reason').notNull(),
    /** Null for a permanent sanction. */
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }),

    issuedByUserId: fk('issued_by_user_id').references(() => users.id, { onDelete: 'set null' }),

    liftedAt: timestamp('lifted_at', { withTimezone: true, mode: 'date' }),
    liftedByUserId: fk('lifted_by_user_id').references(() => users.id, { onDelete: 'set null' }),

    ...timestamps(),
  },
  (table) => [
    // Active sanctions for a user, checked on sensitive actions.
    index('user_sanctions_active_idx')
      .on(table.userId)
      .where(sql`${table.liftedAt} is null`),
    index('user_sanctions_user_idx').on(table.userId, sql`${table.createdAt} desc`),
  ],
);

export const reportsRelations = relations(reports, ({ one }) => ({
  reporter: one(users, { fields: [reports.reporterUserId], references: [users.id] }),
  reviewer: one(users, { fields: [reports.reviewedByUserId], references: [users.id] }),
}));

export const moderationAuditLogRelations = relations(moderationAuditLog, ({ one }) => ({
  actor: one(users, { fields: [moderationAuditLog.actorUserId], references: [users.id] }),
  report: one(reports, { fields: [moderationAuditLog.reportId], references: [reports.id] }),
}));

export const userSanctionsRelations = relations(userSanctions, ({ one }) => ({
  user: one(users, { fields: [userSanctions.userId], references: [users.id] }),
  issuedBy: one(users, { fields: [userSanctions.issuedByUserId], references: [users.id] }),
}));

export type ReportRow = typeof reports.$inferSelect;
export type NewReportRow = typeof reports.$inferInsert;
export type ModerationAuditRow = typeof moderationAuditLog.$inferSelect;
export type NewModerationAuditRow = typeof moderationAuditLog.$inferInsert;
export type UserSanctionRow = typeof userSanctions.$inferSelect;
