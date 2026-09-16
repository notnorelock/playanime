import type { NotificationPage, NotificationQuery } from '@playanime/contracts';
import { http, type QueryParams } from './client';

export const notificationsApi = {
  list: (query: NotificationQuery = {}, signal?: AbortSignal): Promise<NotificationPage> =>
    http.get<NotificationPage>('/notifications', {
      query: query as QueryParams,
      ...(signal === undefined ? {} : { signal }),
    }),

  /** Marks the given ids read, or every notification when `ids` is omitted. */
  markRead: (ids?: readonly string[]): Promise<unknown> =>
    http.patch<unknown>('/notifications/read', { body: ids === undefined ? {} : { ids } }),

  markOneRead: (notificationId: string): Promise<unknown> =>
    http.patch<unknown>(`/notifications/${encodeURIComponent(notificationId)}/read`),
};
