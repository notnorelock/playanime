import { Elysia, t } from 'elysia';
import { MarkNotificationsReadBody, NotificationQuery } from '@playanime/contracts';
import { requireAuth } from '@playanime/auth';
import { sessionContext } from '../../plugins/session.js';
import { listNotifications, markNotificationRead, markNotificationsRead } from './notifications.service.js';

export const notificationsController = new Elysia({ prefix: '/notifications' })
  .use(sessionContext)
  .get('/', ({ query, session }) => listNotifications(requireAuth(session).user.id, query), {
    query: NotificationQuery,
    detail: { summary: 'List own notifications', tags: ['notifications'] },
  })
  .patch('/read', ({ body, session }) => markNotificationsRead(requireAuth(session).user.id, body.ids), {
    body: MarkNotificationsReadBody,
    detail: { summary: 'Mark notifications read', tags: ['notifications'] },
  })
  .patch(
    '/:notificationId/read',
    ({ params, session }) => markNotificationRead(requireAuth(session).user.id, params.notificationId),
    {
      params: t.Object({ notificationId: t.String({ format: 'uuid' }) }),
      detail: { summary: 'Mark one notification read', tags: ['notifications'] },
    },
  );
