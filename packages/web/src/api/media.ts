import type { AvatarHistoryResponse, AvatarUploadResponse } from '@playanime/contracts'
import { http } from './client'

/**
 * Avatar uploads. Uploading converts to WebP, generates size variants, and
 * activates the result as the caller's current avatar in one call — unlike
 * the old flat-file version of this endpoint, the caller does not need a
 * follow-up `profilesApi.update({avatar: url})`.
 */
export const mediaApi = {
  uploadAvatar: (file: File, signal?: AbortSignal): Promise<AvatarUploadResponse> =>
    http.upload<AvatarUploadResponse>('/media/avatar', 'file', file, signal === undefined ? {} : { signal }),

  /** The caller's own upload history — every upload kept until explicitly deleted. */
  getAvatarHistory: (signal?: AbortSignal): Promise<AvatarHistoryResponse> =>
    http.get<AvatarHistoryResponse>('/profile/avatar-history', signal === undefined ? {} : { signal }),

  activateAvatar: (id: string): Promise<AvatarUploadResponse> =>
    http.post<AvatarUploadResponse>(`/media/avatar/${encodeURIComponent(id)}/activate`, {}),

  deleteAvatarUpload: (id: string): Promise<{ success: true }> =>
    http.delete<{ success: true }>(`/media/avatar/${encodeURIComponent(id)}`)
}
