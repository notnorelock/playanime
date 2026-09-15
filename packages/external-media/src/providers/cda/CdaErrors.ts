import { ExternalMediaResolutionError } from '../../errors.js';
import { ErrorCode } from '@playanime/shared';

export type CdaErrorReason =
  | 'CDA_INVALID_URL'
  | 'CDA_PAGE_FETCH_FAILED'
  | 'CDA_PLAYER_DATA_NOT_FOUND'
  | 'CDA_PLAYER_DATA_INVALID'
  | 'CDA_VIDEO_UNAVAILABLE'
  | 'CDA_QUALITY_RESOLVE_FAILED'
  | 'CDA_API_ERROR';

/** No upstream bodies, tokens or transport errors enter logs or client errors. */
export class CdaError extends ExternalMediaResolutionError {
  constructor(readonly reason: CdaErrorReason) {
    super(`CDA playback could not be resolved (${reason}).`, {
      details: { provider: 'cda', reason },
      ...(reason === 'CDA_INVALID_URL' ? { code: ErrorCode.MEDIA_INVALID_URL, status: 422 } : {}),
      ...(reason === 'CDA_VIDEO_UNAVAILABLE'
        ? { code: ErrorCode.MEDIA_SOURCE_UNAVAILABLE, status: 404 }
        : {}),
    });
  }
}
