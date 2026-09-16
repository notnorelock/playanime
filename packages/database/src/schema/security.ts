import { relations, sql } from 'drizzle-orm';
import { index, jsonb, pgTable, uuid, varchar } from 'drizzle-orm/pg-core';
import { createdAt, fk, primaryId } from './_shared.js';
import { users } from './users.js';

/**
 * Self-service security events — a user acting on their own session or
 * device (revoke, block, rename) — as distinct from `moderation_audit_log`,
 * which is a moderator acting on someone else's content. The two are kept as
 * separate tables because they have different actor/target relationships and
 * different growth patterns, not because one supersedes the other.
 *
 * `eventType` is a plain `varchar`, not a strict Postgres enum like
 * `moderation_audit_log.action`. `ModerationAction` is a small, curated set
 * that rarely changes; this table's event set grows across features (session
 * management, playback handoff, ...) and a strict enum would need a schema
 * migration for every new event name. Type safety comes from the
 * `SecurityEventType` const in `@playanime/contracts` instead.
 */
export const securityEvents = pgTable(
  'security_events',
  {
    id: primaryId(),
    /** Null so the row survives account deletion, matching moderation_audit_log's own actor nullability. */
    actorUserId: fk('actor_user_id').references(() => users.id, { onDelete: 'set null' }),

    eventType: varchar('event_type', { length: 64 }).notNull(),

    /**
     * Polymorphic, no FK constraint — a session id, a device id, or nothing
     * at all depending on `eventType`. Must survive deletion of whatever it
     * names, the same reasoning `reports.targetId` already uses.
     */
    targetId: uuid('target_id'),

    /** Never raw session secrets or tokens — see the append helper's own guard. */
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),

    createdAt: createdAt(),
  },
  (table) => [
    // "Show me my own recent security activity," and the cursor-paginated event log.
    index('security_events_actor_idx').on(table.actorUserId, table.createdAt),
  ],
);

export const securityEventsRelations = relations(securityEvents, ({ one }) => ({
  actor: one(users, { fields: [securityEvents.actorUserId], references: [users.id] }),
}));

export type SecurityEventRow = typeof securityEvents.$inferSelect;
export type NewSecurityEventRow = typeof securityEvents.$inferInsert;
