/**
 * Backend error codes to translation keys.
 *
 * The API returns a stable, machine-readable `code` and a Polish message. The
 * code is what the frontend branches on; the translation lets the UI phrase the
 * failure in the viewer's language rather than echoing the server's copy.
 *
 * Keys mirror `ErrorCode` in `@playanime/shared`. An unmapped code falls back
 * to the server's own message, which is always safe to display — the API
 * decides what is exposable before it serializes.
 */
export const ERROR_CODE_MAP: Readonly<Record<string, string>> = {
  VALIDATION_FAILED: 'errors.validationFailed',

  UNAUTHENTICATED: 'errors.unauthorized',
  INVALID_CREDENTIALS: 'errors.auth.invalidCredentials',
  SESSION_EXPIRED: 'errors.auth.sessionExpired',
  SESSION_REVOKED: 'errors.auth.sessionExpired',
  EMAIL_NOT_VERIFIED: 'errors.auth.emailNotVerified',
  CSRF_TOKEN_INVALID: 'errors.auth.csrfInvalid',

  FORBIDDEN: 'errors.forbidden',
  INSUFFICIENT_ROLE: 'errors.permission.insufficient',

  NOT_FOUND: 'errors.notFound',
  ANIME_NOT_FOUND: 'errors.anime.notFound',
  EPISODE_NOT_FOUND: 'errors.episode.notFound',
  USER_NOT_FOUND: 'errors.user.notFound',
  SOURCE_NOT_FOUND: 'errors.media.sourceNotFound',

  MEDIA_INVALID_URL: 'errors.media.invalidUrl',
  MEDIA_SOURCE_UNAVAILABLE: 'errors.media.unavailable',
  MEDIA_ACCESS_DENIED: 'errors.media.accessDenied',
  MEDIA_RESOLUTION_FAILED: 'errors.media.resolutionFailed',
  MEDIA_UNSUPPORTED_PROVIDER: 'errors.media.unsupportedProvider',

  CONFLICT: 'errors.conflict',
  EMAIL_ALREADY_REGISTERED: 'errors.auth.emailExists',
  USERNAME_TAKEN: 'errors.auth.usernameExists',
  ALREADY_EXISTS: 'errors.conflict',

  RATE_LIMITED: 'errors.rateLimited',

  PAYLOAD_TOO_LARGE: 'errors.payloadTooLarge',
  UNSUPPORTED_MEDIA_TYPE: 'errors.badRequest',

  INTERNAL_ERROR: 'errors.internal',
  SERVICE_UNAVAILABLE: 'errors.serviceUnavailable',
  DEPENDENCY_UNAVAILABLE: 'errors.serviceUnavailable',
};

/** Translation key for a code, or null when the code has no mapping. */
export function getErrorKey(code: string | undefined): string | null {
  if (code === undefined) return null;
  return ERROR_CODE_MAP[code] ?? null;
}
