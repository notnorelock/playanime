import type {
  AdminAnalyticsDto,
  AdminAnalyticsQuery,
  AdminAnimePage,
  AdminAnimeQuery,
  AdminAnimeUpdateBody,
  AdminCommentPage,
  AdminCommentQuery,
  AdminOverviewDto,
  AdminRoleUpdateBody,
  AdminSanctionBody,
  AdminSanctionDto,
  AdminUserPage,
  AdminUserQuery,
  TranslatorGroupPage,
  TranslatorGroupQuery,
} from '@playanime/contracts';
import { http, type QueryParams } from './client';

/**
 * Administration console.
 *
 * Every call here requires a staff role, enforced server-side. The UI hides
 * what a given role cannot use, but that is presentation — these endpoints
 * reject the request regardless of what the client chose to render.
 */
export const adminApi = {
  overview: (signal?: AbortSignal): Promise<AdminOverviewDto> =>
    http.get<AdminOverviewDto>('/admin/overview', signal === undefined ? {} : { signal }),

  analytics: (query: AdminAnalyticsQuery = {}, signal?: AbortSignal): Promise<AdminAnalyticsDto> =>
    http.get<AdminAnalyticsDto>('/admin/analytics', {
      query: query as QueryParams,
      ...(signal === undefined ? {} : { signal }),
    }),

  /* ------------------------------------------------------------------ */
  /* Users — administrators only                                         */
  /* ------------------------------------------------------------------ */

  users: (query: AdminUserQuery = {}, signal?: AbortSignal): Promise<AdminUserPage> =>
    http.get<AdminUserPage>('/admin/users', {
      query: query as QueryParams,
      ...(signal === undefined ? {} : { signal }),
    }),

  updateRole: (userId: string, body: AdminRoleUpdateBody): Promise<{ id: string; role: string }> =>
    http.patch<{ id: string; role: string }>(
      `/admin/users/${encodeURIComponent(userId)}/role`,
      { body },
    ),

  sanction: (userId: string, body: AdminSanctionBody): Promise<AdminSanctionDto> =>
    http.post<AdminSanctionDto>(`/admin/users/${encodeURIComponent(userId)}/sanctions`, { body }),

  sanctions: (userId: string, signal?: AbortSignal): Promise<AdminSanctionDto[]> =>
    http.get<AdminSanctionDto[]>(
      `/admin/users/${encodeURIComponent(userId)}/sanctions`,
      signal === undefined ? {} : { signal },
    ),

  liftSanctions: (userId: string, reason: string): Promise<{ success: boolean }> =>
    http.delete<{ success: boolean }>(`/admin/users/${encodeURIComponent(userId)}/sanctions`, {
      body: { reason },
    }),

  /* ------------------------------------------------------------------ */
  /* Catalogue                                                           */
  /* ------------------------------------------------------------------ */

  anime: (query: AdminAnimeQuery = {}, signal?: AbortSignal): Promise<AdminAnimePage> =>
    http.get<AdminAnimePage>('/admin/anime', {
      query: query as QueryParams,
      ...(signal === undefined ? {} : { signal }),
    }),

  updateAnime: (animeId: string, body: AdminAnimeUpdateBody): Promise<{ id: string }> =>
    http.patch<{ id: string }>(`/admin/anime/${encodeURIComponent(animeId)}`, { body }),

  /** Soft hide: sources and library entries keep their referent. */
  hideAnime: (animeId: string, reason: string): Promise<{ id: string; deleted: boolean }> =>
    http.post<{ id: string; deleted: boolean }>(
      `/admin/anime/${encodeURIComponent(animeId)}/hide`,
      { body: { reason } },
    ),

  restoreAnime: (animeId: string, reason: string): Promise<{ id: string; deleted: boolean }> =>
    http.post<{ id: string; deleted: boolean }>(
      `/admin/anime/${encodeURIComponent(animeId)}/restore`,
      { body: { reason } },
    ),

  /* ------------------------------------------------------------------ */
  /* Comments                                                            */
  /* ------------------------------------------------------------------ */

  comments: (query: AdminCommentQuery = {}, signal?: AbortSignal): Promise<AdminCommentPage> =>
    http.get<AdminCommentPage>('/admin/comments', {
      query: query as QueryParams,
      ...(signal === undefined ? {} : { signal }),
    }),

  removeComment: (commentId: string, reason: string): Promise<{ id: string; removed: boolean }> =>
    http.post<{ id: string; removed: boolean }>(
      `/admin/comments/${encodeURIComponent(commentId)}/remove`,
      { body: { reason } },
    ),

  restoreComment: (commentId: string, reason: string): Promise<{ id: string; removed: boolean }> =>
    http.post<{ id: string; removed: boolean }>(
      `/admin/comments/${encodeURIComponent(commentId)}/restore`,
      { body: { reason } },
    ),

  /* ------------------------------------------------------------------ */
  /* Translator groups                                                   */
  /* ------------------------------------------------------------------ */

  /** Reuses the public directory listing; moderation acts on a slug. */
  translators: (
    query: TranslatorGroupQuery = {},
    signal?: AbortSignal,
  ): Promise<TranslatorGroupPage> =>
    http.get<TranslatorGroupPage>('/translators', {
      query: query as QueryParams,
      ...(signal === undefined ? {} : { signal }),
    }),

  verifyGroup: (slug: string, reason: string): Promise<{ id: string; isVerified: boolean }> =>
    http.post<{ id: string; isVerified: boolean }>(
      `/admin/translators/${encodeURIComponent(slug)}/verify`,
      { body: { reason } },
    ),

  unverifyGroup: (slug: string, reason: string): Promise<{ id: string; isVerified: boolean }> =>
    http.delete<{ id: string; isVerified: boolean }>(
      `/admin/translators/${encodeURIComponent(slug)}/verify`,
      { body: { reason } },
    ),

  suspendGroup: (slug: string, reason: string): Promise<{ id: string; isSuspended: boolean }> =>
    http.post<{ id: string; isSuspended: boolean }>(
      `/admin/translators/${encodeURIComponent(slug)}/suspend`,
      { body: { reason } },
    ),

  restoreGroup: (slug: string, reason: string): Promise<{ id: string; isSuspended: boolean }> =>
    http.delete<{ id: string; isSuspended: boolean }>(
      `/admin/translators/${encodeURIComponent(slug)}/suspend`,
      { body: { reason } },
    ),
};
