import type {
  DiscordCompleteSignupBody,
  LinkedAccountDto,
  LoginResponse,
  ResendVerificationResponse,
  SessionResponse,
  SessionSummary,
  SessionUser,
  TwoFactorConfirmBody,
  TwoFactorConfirmResponse,
  TwoFactorDisableBody,
  TwoFactorSetupResponse,
  TwoFactorStatus,
  TwoFactorVerifyBody,
  VerifyEmailResponse,
} from '@playanime/contracts';
import { getOrCreateDeviceId } from '@/composables/useDeviceId';
import { API_BASE_URL, http } from './client';

/**
 * Authentication.
 *
 * No function here returns or stores a token: the API delivers the session as
 * an HttpOnly cookie, and the browser attaches it automatically. `me()` is the
 * only source of truth about who is signed in.
 *
 * `register`/`login`/`verifyTwoFactor` all attach this browser's device id —
 * added here, not at each call site, so a caller can't forget it and every
 * new session gets tied to a device the same way.
 */
export const authApi = {
  register: (body: { email: string; username: string; password: string }): Promise<SessionResponse> =>
    http.post<SessionResponse>('/auth/register', { body: { ...body, deviceId: getOrCreateDeviceId() } }),

  /** Resolves to `{ kind: 'authenticated', user }` or `{ kind: 'two_factor_required', challengeToken }`. */
  login: (body: { email: string; password: string }): Promise<LoginResponse> =>
    http.post<LoginResponse>('/auth/login', { body: { ...body, deviceId: getOrCreateDeviceId() } }),

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

  /* -------------------------------------------------------------------- */
  /* Two-factor authentication                                             */
  /* -------------------------------------------------------------------- */

  twoFactorStatus: (): Promise<TwoFactorStatus> => http.get<TwoFactorStatus>('/auth/2fa/status'),

  startTwoFactorSetup: (): Promise<TwoFactorSetupResponse> =>
    http.post<TwoFactorSetupResponse>('/auth/2fa/setup'),

  confirmTwoFactorSetup: (body: TwoFactorConfirmBody): Promise<TwoFactorConfirmResponse> =>
    http.post<TwoFactorConfirmResponse>('/auth/2fa/confirm', { body }),

  disableTwoFactor: (body: TwoFactorDisableBody): Promise<{ success: boolean }> =>
    http.post<{ success: boolean }>('/auth/2fa/disable', { body }),

  verifyTwoFactor: (body: TwoFactorVerifyBody): Promise<SessionResponse> =>
    http.post<SessionResponse>('/auth/2fa/verify', { body: { ...body, deviceId: getOrCreateDeviceId() } }),

  /* -------------------------------------------------------------------- */
  /* Email verification                                                    */
  /* -------------------------------------------------------------------- */

  verifyEmail: (code: string): Promise<VerifyEmailResponse> =>
    http.post<VerifyEmailResponse>('/auth/verify-email', { body: { code } }),

  resendVerification: (): Promise<ResendVerificationResponse> =>
    http.post<ResendVerificationResponse>('/auth/resend-verification'),
};

export type { SessionUser };
