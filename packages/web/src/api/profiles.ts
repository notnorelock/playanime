import type {
  ActivityPage,
  ActivityQuery,
  FollowListQuery,
  LibraryPage,
  LibraryQuery,
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
