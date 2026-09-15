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
    check(
      'notifications_kind_check',
      sql`${table.kind} in (${sql.join(
        NOTIFICATION_KINDS.map((kind) => sql`${kind}`),
        sql`, `,
      )})`,
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
