import type {
  DiscordCompleteSignupBody,
  LinkedAccountDto,
  SessionResponse,
  SessionSummary,
  SessionUser,
} from '@playanime/contracts';
import { API_BASE_URL, http } from './client';

/**
 * Authentication.
 *
 * No function here returns or stores a token: the API delivers the session as
 * an HttpOnly cookie, and the browser attaches it automatically. `me()` is the
 * only source of truth about who is signed in.
 */
export const authApi = {
  register: (body: { email: string; username: string; password: string }): Promise<SessionResponse> =>
    http.post<SessionResponse>('/auth/register', { body }),

  login: (body: { email: string; password: string }): Promise<SessionResponse> =>
    http.post<SessionResponse>('/auth/login', { body }),

  logout: (): Promise<{ success: boolean }> => http.post<{ success: boolean }>('/auth/logout'),

  /** Throws `ApiError` with status 401 when no valid session exists. */
  me: (signal?: AbortSignal): Promise<SessionResponse> =>
    http.get<SessionResponse>('/auth/me', signal === undefined ? {} : { signal }),

  listSessions: (): Promise<SessionSummary[]> => http.get<SessionSummary[]>('/auth/sessions'),

  revokeSession: (id: string): Promise<{ success: boolean }> =>
    http.delete<{ success: boolean }>(`/auth/sessions/${encodeURIComponent(id)}`),

  revokeOtherSessions: (): Promise<{ revoked: number }> =>
    http.post<{ revoked: number }>('/auth/sessions/revoke-all'),

  /**
   * Full-page navigation, not a `fetch` call: the API responds with a 302 to
   * Discord, which only works as a real browser navigation.
   */
  discordAuthUrl: (): string => `${API_BASE_URL}/auth/discord`,

  completeDiscordSignup: (body: DiscordCompleteSignupBody): Promise<SessionResponse> =>
    http.post<SessionResponse>('/auth/discord/complete-signup', { body }),

  linkedAccounts: (): Promise<LinkedAccountDto[]> =>
    http.get<LinkedAccountDto[]>('/auth/linked-accounts'),

  unlinkAccount: (provider: string): Promise<{ success: boolean }> =>
    http.delete<{ success: boolean }>(`/auth/linked-accounts/${encodeURIComponent(provider)}`),
};

export type { SessionUser };
