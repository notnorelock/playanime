import { relations, sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { createdAt, episodeReportReasonEnum, episodeReportStatusEnum, fk, primaryId } from './_shared.js';
import { episodes } from './anime.js';
import { users } from './users.js';

/**
 * Episode reports — "report episode" on the watch page. See
 * `packages/contracts/src/episode-reports/index.ts` for the full design
 * rationale and why this is separate from the general `reports` system.
 *
 * One row per report, not an envelope+thread: resolution is a single
 * status + optional reply, not an ongoing back-and-forth conversation —
 * unlike `support_tickets`, there is no further reply from the reporter.
 */
export const episodeReports = pgTable(
  'episode_reports',
  {
    id: primaryId(),
    episodeId: fk('episode_id')
      .references(() => episodes.id, { onDelete: 'cascade' })
      .notNull(),
    reporterUserId: fk('reporter_user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    reason: episodeReportReasonEnum('reason').notNull(),
    description: text('description'),

    status: episodeReportStatusEnum('status').notNull().default('open'),
    /** Set on resolution — shown to the reporter in the resolution email. */
    replyText: text('reply_text'),
    resolvedByUserId: fk('resolved_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true, mode: 'date' }),

    createdAt: createdAt(),
  },
  (table) => [
    index('episode_reports_episode_idx').on(table.episodeId),
    index('episode_reports_status_idx').on(table.status, sql`${table.createdAt} desc`),
  ],
);

export const episodeReportsRelations = relations(episodeReports, ({ one }) => ({
  episode: one(episodes, { fields: [episodeReports.episodeId], references: [episodes.id] }),
  reporter: one(users, { fields: [episodeReports.reporterUserId], references: [users.id] }),
  resolvedBy: one(users, { fields: [episodeReports.resolvedByUserId], references: [users.id] }),
}));

export type EpisodeReportRow = typeof episodeReports.$inferSelect;
export type NewEpisodeReportRow = typeof episodeReports.$inferInsert;
