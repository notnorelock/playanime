import { and, desc, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import type { Database } from '../client/index.js';
import { notifications } from '../schema/notifications.js';

export class NotificationRepository {
  constructor(private readonly db: Database) {}

  list(userId: string, unreadOnly: boolean, limit: number, before: Date | null) {
    return this.db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, userId),
          unreadOnly ? isNull(notifications.readAt) : undefined,
          before === null ? undefined : lt(notifications.createdAt, before),
        ),
      )
      .orderBy(desc(notifications.createdAt))
      .limit(limit + 1);
  }

  async unreadCount(userId: string): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::integer` })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
    return row?.count ?? 0;
  }

  async markRead(userId: string, timestamp: Date, ids?: readonly string[]): Promise<number> {
    if (ids?.length === 0) return 0;
    const rows = await this.db
      .update(notifications)
      .set({ readAt: timestamp })
      .where(
        and(
          eq(notifications.userId, userId),
          isNull(notifications.readAt),
          ids === undefined ? undefined : inArray(notifications.id, [...ids]),
        ),
      )
      .returning({ id: notifications.id });
    return rows.length;
  }

  async markOneRead(userId: string, notificationId: string, timestamp: Date): Promise<number> {
    const rows = await this.db
      .update(notifications)
      .set({ readAt: timestamp })
      .where(and(eq(notifications.id, notificationId), eq(notifications.userId, userId)))
      .returning({ id: notifications.id });
    return rows.length;
  }
}
