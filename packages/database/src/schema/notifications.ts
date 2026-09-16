import { relations, sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';
import { NOTIFICATION_KINDS } from '@playanime/contracts';
import { createdAt, fk, primaryId } from './_shared.js';
import { users } from './users.js';

const notificationKindValues = [...NOTIFICATION_KINDS] as [string, ...string[]];

export const notifications = pgTable(
  'notifications',
  {
    id: primaryId(),
    userId: fk('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    actorUserId: fk('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    kind: varchar('kind', { length: 32, enum: notificationKindValues }).notNull(),
    title: varchar('title', { length: 160 }).notNull(),
    body: text('body').notNull(),
    href: varchar('href', { length: 512 }),
    readAt: timestamp('read_at', { withTimezone: true, mode: 'date' }),
    createdAt: createdAt(),
  },
  (table) => [
    /*
     * The allowed values are inlined with `sql.raw`, not bound as parameters.
     *
     * `sql`${kind}`` would bind each one, and drizzle-kit serializes a bound
     * parameter into generated DDL as `$1`, `$2`, … — which Postgres rejects
     * with "there is no parameter $1" when the migration runs. A CHECK
     * constraint is DDL and has to carry literals.
     *
     * The values come from a compile-time constant in @playanime/contracts, so
     * nothing user-supplied reaches this string.
     */
    check(
      'notifications_kind_check',
      sql.raw(
        `"kind" in (${NOTIFICATION_KINDS.map((kind) => `'${kind}'`).join(', ')})`,
      ),
    ),
    index('notifications_user_created_idx').on(table.userId, sql`${table.createdAt} desc`),
    index('notifications_user_unread_idx')
      .on(table.userId, sql`${table.createdAt} desc`)
      .where(sql`${table.readAt} is null`),
  ],
);

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, { fields: [notifications.userId], references: [users.id] }),
  actor: one(users, { fields: [notifications.actorUserId], references: [users.id] }),
}));

export type NotificationRow = typeof notifications.$inferSelect;
export type NewNotificationRow = typeof notifications.$inferInsert;
