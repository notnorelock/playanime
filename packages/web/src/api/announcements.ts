import type { ActiveAnnouncementDto, AnnouncementDto, AnnouncementSetBody } from '@playanime/contracts';
import { http } from './client';

/** The homepage announcement strip. Public read, admin-only write. */
export const announcementsApi = {
  active: (signal?: AbortSignal): Promise<ActiveAnnouncementDto> =>
    http.get<ActiveAnnouncementDto>('/announcements/active', signal === undefined ? {} : { signal }),

  /** Admin-only: every announcement ever set, newest first. */
  history: (signal?: AbortSignal): Promise<AnnouncementDto[]> =>
    http.get<AnnouncementDto[]>('/announcements/history', signal === undefined ? {} : { signal }),

  set: (body: AnnouncementSetBody): Promise<AnnouncementDto> =>
    http.post<AnnouncementDto>('/announcements', { body }),

  clear: (): Promise<{ success: boolean }> => http.delete<{ success: boolean }>('/announcements'),
};
