import type { NotificationRepository } from '@playanime/database';

type NotificationRow = Awaited<ReturnType<NotificationRepository['list']>>[number];

export function toNotification(row: NotificationRow) {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    href: row.href,
    actorUserId: row.actorUserId,
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
