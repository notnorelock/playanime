import { ErrorCode } from '@playanime/shared';
import { ExternalMediaResolutionError } from '../../errors.js';

export type ByseErrorReason =
  | 'BYSE_INVALID_URL'
  | 'BYSE_INVALID_FILE_CODE'
  | 'BYSE_FILE_UNAVAILABLE'
  | 'BYSE_FILE_CANNOT_PLAY'
  | 'BYSE_API_UNAVAILABLE'
  | 'BYSE_INVALID_API_RESPONSE'
  | 'BYSE_DOMAIN_LOOKUP_FAILED'
  | 'BYSE_PLAYBACK_DECRYPT_FAILED'
  | 'BYSE_CAPTCHA_REQUIRED'
  | 'BYSE_CAPTCHA_SOLVE_FAILED'
  | 'BYSE_ATTESTATION_FAILED';

/** No upstream bodies, tokens or transport errors enter logs or client errors. */
export class ByseError extends ExternalMediaResolutionError {
  constructor(readonly reason: ByseErrorReason) {
    super(`Byse playback could not be resolved (${reason}).`, {
      details: { provider: 'byse', reason },
      ...(reason === 'BYSE_INVALID_URL' || reason === 'BYSE_INVALID_FILE_CODE'
        ? { code: ErrorCode.MEDIA_INVALID_URL, status: 422 }
        : {}),
      ...(reason === 'BYSE_FILE_UNAVAILABLE' || reason === 'BYSE_FILE_CANNOT_PLAY'
        ? { code: ErrorCode.MEDIA_SOURCE_UNAVAILABLE, status: 404 }
        : {}),
    });
  }
}
