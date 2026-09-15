import type { LoginBody, RegisterBody, SessionResponse, SessionUser } from '@playanime/contracts';
import { api, ApiError } from '~/services/api-client.js';

/**
 * Session HTTP boundary.
 *
 * Cookie and CSRF handling stays in the shared API client; this module only
 * knows the authentication endpoints and their contracts.
 */
export async function getCurrentUser(signal?: AbortSignal): Promise<SessionUser | null> {
  try {
    const response = await api.get<SessionResponse>('/auth/me', { signal });
    return response.user;
  } catch (error: unknown) {
    // A missing/expired session is a valid guest state, not a failed resource.
    if (error instanceof ApiError && error.isUnauthenticated) return null;
    throw error;
  }
}

export async function login(body: LoginBody): Promise<SessionUser> {
  const response = await api.post<SessionResponse>('/auth/login', body);
  return response.user;
}

export async function register(body: RegisterBody): Promise<SessionUser> {
  const response = await api.post<SessionResponse>('/auth/register', body);
  return response.user;
}

export async function logout(): Promise<void> {
  await api.post<{ success: boolean }>('/auth/logout');
}
