import type {
  ActivityPage,
  ActivityQuery,
  DeleteAccountBody,
  FollowListQuery,
  LibraryPage,
  LibraryQuery,
  MySanctionsResponse,
  PreferencesUpdateBody,
  ProfilePage,
  ProfileUpdateBody,
  PublicProfile,
  UserPreferences,
} from '@playanime/contracts';
import { http, type QueryParams } from './client';

/** Public profiles, follows, and the signed-in user's own preferences. */
export const profilesApi = {
  me: (signal?: AbortSignal): Promise<PublicProfile> =>
    http.get<PublicProfile>('/profiles/me', signal === undefined ? {} : { signal }),

  byUsername: (username: string, signal?: AbortSignal): Promise<PublicProfile> =>
    http.get<PublicProfile>(
      `/profiles/${encodeURIComponent(username)}`,
      signal === undefined ? {} : { signal },
    ),

  update: (body: ProfileUpdateBody): Promise<PublicProfile> =>
    http.patch<PublicProfile>('/profile', { body }),

  preferences: (signal?: AbortSignal): Promise<UserPreferences> =>
    http.get<UserPreferences>('/preferences', signal === undefined ? {} : { signal }),

  updatePreferences: (body: PreferencesUpdateBody): Promise<UserPreferences> =>
    http.patch<UserPreferences>('/preferences', { body }),

  /** The caller's own sanction history. Never another user's. */
  mySanctions: (signal?: AbortSignal): Promise<MySanctionsResponse> =>
    http.get<MySanctionsResponse>('/profiles/me/sanctions', signal === undefined ? {} : { signal }),

  /**
   * Deletes the caller's own account. Content left elsewhere (comments,
   * ratings, catalogue attribution) is not touched — only the account and
   * its credentials.
   */
  deleteAccount: (body: DeleteAccountBody): Promise<{ success: boolean }> =>
    http.delete<{ success: boolean }>('/profile', { body }),

  follow: (username: string): Promise<unknown> =>
    http.post<unknown>(`/profiles/${encodeURIComponent(username)}/follow`),

  unfollow: (username: string): Promise<unknown> =>
    http.delete<unknown>(`/profiles/${encodeURIComponent(username)}/follow`),

  activity: (username: string, query: ActivityQuery = {}, signal?: AbortSignal): Promise<ActivityPage> =>
    http.get<ActivityPage>(`/profiles/${encodeURIComponent(username)}/activity`, {
      query: query as QueryParams,
      ...(signal === undefined ? {} : { signal }),
    }),

  /** Entries the profile owner has not marked private. */
  library: (username: string, query: LibraryQuery = {}, signal?: AbortSignal): Promise<LibraryPage> =>
    http.get<LibraryPage>(`/profiles/${encodeURIComponent(username)}/library`, {
      query: query as QueryParams,
      ...(signal === undefined ? {} : { signal }),
    }),

  follows: (
    username: string,
    relation: 'followers' | 'following',
    query: FollowListQuery = {},
    signal?: AbortSignal,
  ): Promise<ProfilePage> =>
    http.get<ProfilePage>(`/profiles/${encodeURIComponent(username)}/${relation}`, {
      query: query as QueryParams,
      ...(signal === undefined ? {} : { signal }),
    }),
};
