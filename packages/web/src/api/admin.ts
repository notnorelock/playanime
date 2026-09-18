import type {
  AuditLogEntryDto,
  ContactMessageDto,
  ContactMessageThreadDto,
  ContactReplyBody,
  ModerationDecisionRequest,
  PendingReportDto,
  PendingSourceDto,
  ReportDecisionRequest,
  AdminAnalyticsDto,
  AdminAnalyticsQuery,
  AdminCommentPage,
  AdminCommentQuery,
  AdminEntryUpdateBody,
  AdminOverviewDto,
  AdminRoleUpdateBody,
  AdminSanctionBody,
  AdminSanctionDto,
  AdminSeriesPage,
  AdminSeriesQuery,
  AdminSeriesUpdateBody,
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

  anime: (query: AdminSeriesQuery = {}, signal?: AbortSignal): Promise<AdminSeriesPage> =>
    http.get<AdminSeriesPage>('/admin/anime', {
      query: query as QueryParams,
      ...(signal === undefined ? {} : { signal }),
    }),

  /** Edits the series' main entry — `status`/`episodeCount`/`synopsis` live there now. */
  updateAnime: (animeId: string, body: AdminEntryUpdateBody): Promise<{ id: string }> =>
    http.patch<{ id: string }>(`/admin/anime/${encodeURIComponent(animeId)}`, { body }),

  /** Edits the series itself — `isAdult`/`synopsis` — separate from `updateAnime`, which edits its main entry. */
  updateAnimeSeries: (seriesId: string, body: AdminSeriesUpdateBody): Promise<{ id: string }> =>
    http.patch<{ id: string }>(`/admin/anime/${encodeURIComponent(seriesId)}/series`, { body }),

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

  /** Hard delete — the series, its entries, episodes and every user's ratings/comments/watch progress on it, irreversibly. */
  deleteAnime: (animeId: string, reason: string): Promise<{ id: string }> =>
    http.delete<{ id: string }>(`/admin/anime/${encodeURIComponent(animeId)}`, {
      body: { reason },
    }),

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

  /* ------------------------------------------------------------------ */
  /* Source moderation                                                   */
  /* ------------------------------------------------------------------ */

  /** Pending sources, oldest first. Includes the rights attestation timestamp. */
  pendingSources: (limit = 50, signal?: AbortSignal): Promise<PendingSourceDto[]> =>
    http.get<PendingSourceDto[]>('/admin/sources/pending', {
      query: { limit },
      ...(signal === undefined ? {} : { signal }),
    }),

  approveSource: (sourceId: string, body: ModerationDecisionRequest): Promise<unknown> =>
    http.post<unknown>(`/admin/sources/${encodeURIComponent(sourceId)}/approve`, { body }),

  rejectSource: (sourceId: string, body: ModerationDecisionRequest): Promise<unknown> =>
    http.post<unknown>(`/admin/sources/${encodeURIComponent(sourceId)}/reject`, { body }),

  /** Restorable: the source is hidden, not destroyed. */
  disableSource: (sourceId: string, body: ModerationDecisionRequest): Promise<unknown> =>
    http.post<unknown>(`/admin/sources/${encodeURIComponent(sourceId)}/disable`, { body }),

  /** Permanent: bars the same resource from ever being resubmitted. */
  blockSource: (sourceId: string, body: ModerationDecisionRequest): Promise<unknown> =>
    http.post<unknown>(`/admin/sources/${encodeURIComponent(sourceId)}/block`, { body }),

  /** The decision history for one object, newest first. */
  auditLog: (
    targetType: string,
    targetId: string,
    signal?: AbortSignal,
  ): Promise<AuditLogEntryDto[]> =>
    http.get<AuditLogEntryDto[]>(
      `/admin/audit/${encodeURIComponent(targetType)}/${encodeURIComponent(targetId)}`,
      signal === undefined ? {} : { signal },
    ),

  /* ------------------------------------------------------------------ */
  /* Reports — the takedown/moderation queue                             */
  /* ------------------------------------------------------------------ */

  /** Open and under-review reports, oldest first. */
  pendingReports: (
    targetType?: string,
    limit = 50,
    signal?: AbortSignal,
  ): Promise<PendingReportDto[]> =>
    http.get<PendingReportDto[]>('/reports/pending', {
      query: { limit, ...(targetType === undefined ? {} : { targetType }) },
      ...(signal === undefined ? {} : { signal }),
    }),

  /** Approving an anime-targeted report hides the title and blocks resubmission. */
  decideReport: (reportId: string, body: ReportDecisionRequest): Promise<unknown> =>
    http.post<unknown>(`/reports/${encodeURIComponent(reportId)}/decision`, { body }),

  /* ------------------------------------------------------------------ */
  /* Contact inbox                                                       */
  /* ------------------------------------------------------------------ */

  /** Newest first. `CONTACT_EMAIL` isn't an inbox staff can log into — this is the only way to read a submission. */
  contactMessages: (
    status?: string,
    limit = 50,
    signal?: AbortSignal,
  ): Promise<ContactMessageDto[]> =>
    http.get<ContactMessageDto[]>('/contact/messages', {
      query: { limit, ...(status === undefined ? {} : { status }) },
      ...(signal === undefined ? {} : { signal }),
    }),

  /** One conversation with its full, ordered thread. */
  contactThread: (messageId: string, signal?: AbortSignal): Promise<ContactMessageThreadDto> =>
    http.get<ContactMessageThreadDto>(
      `/contact/messages/${encodeURIComponent(messageId)}`,
      signal === undefined ? {} : { signal },
    ),

  /** Records the reply and emails it to the visitor from CONTACT_EMAIL. */
  replyToContactMessage: (messageId: string, body: ContactReplyBody): Promise<unknown> =>
    http.post<unknown>(`/contact/messages/${encodeURIComponent(messageId)}/reply`, { body }),
};
