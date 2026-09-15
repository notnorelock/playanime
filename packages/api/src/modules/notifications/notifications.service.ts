import type { NotificationQuery } from '@playanime/contracts';
import { db, NotificationRepository } from '@playanime/database';
import { clampPageSize, now } from '@playanime/shared';
import { toNotification } from './notifications.mapper.js';

const repository = new NotificationRepository(db());

export async function listNotifications(userId: string, query: NotificationQuery) {
  const limit = clampPageSize(query.limit);
  const parsed = query.cursor === undefined ? null : new Date(query.cursor);
  const before = parsed !== null && !Number.isNaN(parsed.getTime()) ? parsed : null;
  const unreadOnly = query.unreadOnly === true || query.unreadOnly === 'true';
  const [rows, unreadCount] = await Promise.all([
    repository.list(userId, unreadOnly, limit, before),
    repository.unreadCount(userId),
  ]);
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  return {
    items: pageRows.map(toNotification),
    nextCursor: hasMore ? (pageRows.at(-1)?.createdAt.toISOString() ?? null) : null,
    hasMore,
    unreadCount,
  };
}

export async function markNotificationsRead(userId: string, ids?: readonly string[]) {
  return { updated: await repository.markRead(userId, now(), ids) };
}

export async function markNotificationRead(userId: string, notificationId: string) {
  return { updated: await repository.markOneRead(userId, notificationId, now()) };
}
