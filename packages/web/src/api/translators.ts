import type {
  AnimeTranslatorCredit,
  TranslatorAnimeUpsertBody,
  TranslatorApplicationCreateBody,
  TranslatorApplicationDecisionBody,
  TranslatorApplicationPage,
  TranslatorGroupCreateBody,
  TranslatorGroupDetail,
  TranslatorGroupPage,
  TranslatorGroupQuery,
  TranslatorGroupSummary,
  TranslatorGroupUpdateBody,
  TranslatorMemberInviteBody,
  TranslatorMemberUpsertBody,
  TranslatorRole,
} from '@playanime/contracts';
import { http, type QueryParams } from './client';

/** A group the signed-in user belongs to, with their role in it. */
export interface MyTranslatorGroup extends TranslatorGroupSummary {
  readonly viewerRole: TranslatorRole;
}

/**
 * Fansub groups.
 *
 * Reads are public — attribution is the point of the feature. Mutations are
 * authorized against group membership server-side, not against the platform
 * role, so a site administrator is not automatically a group leader.
 */
export const translatorsApi = {
  list: (query: TranslatorGroupQuery = {}, signal?: AbortSignal): Promise<TranslatorGroupPage> =>
    http.get<TranslatorGroupPage>('/translators', {
      query: query as QueryParams,
      ...(signal === undefined ? {} : { signal }),
    }),

  bySlug: (slug: string, signal?: AbortSignal): Promise<TranslatorGroupDetail> =>
    http.get<TranslatorGroupDetail>(
      `/translators/${encodeURIComponent(slug)}`,
      signal === undefined ? {} : { signal },
    ),

  /** Groups the signed-in user belongs to. */
  mine: (signal?: AbortSignal): Promise<MyTranslatorGroup[]> =>
    http.get<MyTranslatorGroup[]>('/translators/mine', signal === undefined ? {} : { signal }),

  /** Groups credited on one entry (a season/movie/OVA), for the title page. Public. */
  forAnime: (entryId: string, signal?: AbortSignal): Promise<AnimeTranslatorCredit[]> =>
    http.get<AnimeTranslatorCredit[]>(
      `/translators/for-anime/${encodeURIComponent(entryId)}`,
      signal === undefined ? {} : { signal },
    ),

  create: (body: TranslatorGroupCreateBody): Promise<TranslatorGroupDetail> =>
    http.post<TranslatorGroupDetail>('/translators', { body }),

  update: (slug: string, body: TranslatorGroupUpdateBody): Promise<TranslatorGroupDetail> =>
    http.patch<TranslatorGroupDetail>(`/translators/${encodeURIComponent(slug)}`, { body }),

  disband: (slug: string): Promise<{ success: boolean }> =>
    http.delete<{ success: boolean }>(`/translators/${encodeURIComponent(slug)}`),

  /* ------------------------------------------------------------------ */
  /* Members                                                             */
  /* ------------------------------------------------------------------ */

  addMember: (slug: string, body: TranslatorMemberInviteBody): Promise<TranslatorGroupDetail> =>
    http.post<TranslatorGroupDetail>(`/translators/${encodeURIComponent(slug)}/members`, { body }),

  updateMember: (
    slug: string,
    userId: string,
    body: TranslatorMemberUpsertBody,
  ): Promise<TranslatorGroupDetail> =>
    http.patch<TranslatorGroupDetail>(
      `/translators/${encodeURIComponent(slug)}/members/${encodeURIComponent(userId)}`,
      { body },
    ),

  removeMember: (slug: string, userId: string): Promise<{ success: boolean }> =>
    http.delete<{ success: boolean }>(
      `/translators/${encodeURIComponent(slug)}/members/${encodeURIComponent(userId)}`,
    ),

  /* ------------------------------------------------------------------ */
  /* Titles                                                              */
  /* ------------------------------------------------------------------ */

  /** Claims an entry (a season/movie/OVA) on the group's behalf — `body.entryId`, not a series id. */
  addTitle: (slug: string, body: TranslatorAnimeUpsertBody): Promise<TranslatorGroupDetail> =>
    http.post<TranslatorGroupDetail>(`/translators/${encodeURIComponent(slug)}/anime`, { body }),

  removeTitle: (slug: string, entryId: string): Promise<{ success: boolean }> =>
    http.delete<{ success: boolean }>(
      `/translators/${encodeURIComponent(slug)}/anime/${encodeURIComponent(entryId)}`,
    ),

  /* ------------------------------------------------------------------ */
  /* Applications                                                        */
  /* ------------------------------------------------------------------ */

  apply: (
    slug: string,
    body: TranslatorApplicationCreateBody,
  ): Promise<{ id: string; status: string }> =>
    http.post<{ id: string; status: string }>(
      `/translators/${encodeURIComponent(slug)}/applications`,
      { body },
    ),

  applications: (
    slug: string,
    query: { cursor?: string; limit?: number; status?: string } = {},
    signal?: AbortSignal,
  ): Promise<TranslatorApplicationPage> =>
    http.get<TranslatorApplicationPage>(
      `/translators/${encodeURIComponent(slug)}/applications`,
      {
        query: query as QueryParams,
        ...(signal === undefined ? {} : { signal }),
      },
    ),

  decideApplication: (
    slug: string,
    applicationId: string,
    body: TranslatorApplicationDecisionBody,
  ): Promise<{ id: string; status: string }> =>
    http.post<{ id: string; status: string }>(
      `/translators/${encodeURIComponent(slug)}/applications/${encodeURIComponent(applicationId)}/decision`,
      { body },
    ),

  withdrawApplication: (applicationId: string): Promise<{ success: boolean }> =>
    http.delete<{ success: boolean }>(
      `/translators/applications/${encodeURIComponent(applicationId)}`,
    ),
};
