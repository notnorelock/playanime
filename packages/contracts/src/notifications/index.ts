import { Type, type Static } from '@sinclair/typebox';
import { CursorPageOf, CursorQuery, IsoDateTime, literalUnion, Uuid } from '../common/index.js';

export const NotificationKind = {
  FOLLOW: 'follow',
  COMMENT_REPLY: 'comment_reply',
  REVIEW_REPLY: 'review_reply',
  MODERATION: 'moderation',
  SYSTEM: 'system',
} as const;
export type NotificationKind = (typeof NotificationKind)[keyof typeof NotificationKind];
export const NOTIFICATION_KINDS = Object.values(NotificationKind);

export const Notification = Type.Object({
  id: Uuid,
  kind: literalUnion(NOTIFICATION_KINDS),
  title: Type.String(),
  body: Type.String(),
  href: Type.Union([Type.String(), Type.Null()]),
  actorUserId: Type.Union([Uuid, Type.Null()]),
  readAt: Type.Union([IsoDateTime, Type.Null()]),
  createdAt: IsoDateTime,
});
export type Notification = Static<typeof Notification>;

export const NotificationQuery = Type.Object({
  ...CursorQuery.properties,
  unreadOnly: Type.Optional(Type.Union([Type.Boolean(), Type.Literal('true'), Type.Literal('false')])),
});
export type NotificationQuery = Static<typeof NotificationQuery>;

export const NotificationPage = Type.Object({
  ...CursorPageOf(Notification).properties,
  unreadCount: Type.Integer({ minimum: 0 }),
});
export type NotificationPage = Static<typeof NotificationPage>;

export const MarkNotificationsReadBody = Type.Object({
  ids: Type.Optional(Type.Array(Uuid, { maxItems: 100 })),
});
export type MarkNotificationsReadBody = Static<typeof MarkNotificationsReadBody>;
