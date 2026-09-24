import type { AvatarUploadResponse } from '@playanime/contracts';
import { http } from './client';

/**
 * Media uploads (an avatar today). Uploading only converts and stores the
 * file, returning a URL — it does not itself change anything; the caller
 * still calls `profilesApi.update({ avatar: url })` to actually set it.
 */
export const mediaApi = {
  uploadAvatar: (file: File, signal?: AbortSignal): Promise<AvatarUploadResponse> =>
    http.upload<AvatarUploadResponse>('/media/avatar', 'file', file, signal === undefined ? {} : { signal }),
};
