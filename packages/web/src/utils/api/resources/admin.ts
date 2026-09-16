/**
 * Admin API Resource
 * Handles admin panel endpoints
 */

import { APIResource } from '../base'
import type {
  ApiResponse,
  PaginatedResponse,
  Anime,
  AdminUser,
  PendingAnime,
  PendingTranslator,
  ReportedComment,
  PlatformStats,
  GrowthStats
} from '@/types'

export class AdminResource extends APIResource {
  // ===== Anime Management =====

  /**
   * Get pending anime for approval
   */
  async getPendingAnime(params?: { page?: number; limit?: number }) {
    const response = await this.client.get<ApiResponse<PaginatedResponse<PendingAnime>>>(
      '/admin/anime/pending',
      { params }
    )
    return response.data
  }

  /**
   * Approve anime
   */
  async approveAnime(animeId: number) {
    const response = await this.client.post<ApiResponse<null>>(`/admin/anime/${animeId}/approve`)
    return response.data
  }

  /**
   * Reject anime
   */
  async rejectAnime(animeId: number) {
    const response = await this.client.post<ApiResponse<null>>(`/admin/anime/${animeId}/reject`)
    return response.data
  }

  /**
   * Get all anime with optional filters
   */
  async getAllAnime(params?: { page?: number; limit?: number; is_approved?: boolean }) {
    const response = await this.client.get<ApiResponse<PaginatedResponse<Anime>>>(
      '/admin/anime',
      { params }
    )
    return response.data
  }

  // ===== User Management =====

  /**
   * Get all users
   */
  async getUsers(params?: {
    page?: number
    limit?: number
    search?: string
    is_active?: boolean
  }) {
    const response = await this.client.get<ApiResponse<PaginatedResponse<AdminUser>>>(
      '/admin/users',
      { params }
    )
    return response.data
  }

  /**
   * Get user by ID
   */
  async getUserById(userId: number) {
    const response = await this.client.get<ApiResponse<AdminUser>>(`/admin/users/${userId}`)
    return response.data
  }

  /**
   * Ban user
   */
  async banUser(userId: number, data: { reason: string; expires_at?: string }) {
    const response = await this.client.post<ApiResponse<null>>(`/admin/users/${userId}/ban`, data)
    return response.data
  }

  /**
   * Unban user
   */
  async unbanUser(userId: number) {
    const response = await this.client.post<ApiResponse<null>>(`/admin/users/${userId}/unban`)
    return response.data
  }

  /**
   * Delete user
   */
  async deleteUser(userId: number) {
    const response = await this.client.delete<ApiResponse<null>>(`/admin/users/${userId}`)
    return response.data
  }

  /**
   * Assign role to user
   */
  async assignRole(userId: number, roleId: number) {
    const response = await this.client.post<ApiResponse<null>>(`/admin/users/${userId}/roles`, {
      role_id: roleId
    })
    return response.data
  }

  /**
   * Remove role from user
   */
  async removeRole(userId: number, roleId: number) {
    const response = await this.client.delete<ApiResponse<null>>(`/admin/users/${userId}/roles`, {
      data: { role_id: roleId }
    })
    return response.data
  }

  // ===== Translator Management =====

  /**
   * Get pending translators
   */
  async getPendingTranslators(params?: { page?: number; limit?: number }) {
    const response = await this.client.get<ApiResponse<PaginatedResponse<PendingTranslator>>>(
      '/admin/translators/pending',
      { params }
    )
    return response.data
  }

  /**
   * Verify translator group
   */
  async verifyTranslator(translatorId: number) {
    const response = await this.client.post<ApiResponse<null>>(
      `/admin/translators/${translatorId}/verify`
    )
    return response.data
  }

  /**
   * Unverify translator group
   */
  async unverifyTranslator(translatorId: number) {
    const response = await this.client.post<ApiResponse<null>>(
      `/admin/translators/${translatorId}/unverify`
    )
    return response.data
  }

  /**
   * Delete translator group
   */
  async deleteTranslator(translatorId: number) {
    const response = await this.client.delete<ApiResponse<null>>(
      `/admin/translators/${translatorId}`
    )
    return response.data
  }

  // ===== Comment Moderation =====

  /**
   * Get reported comments
   */
  async getReportedComments(params?: {
    page?: number
    limit?: number
    status?: 'pending' | 'resolved' | 'dismissed'
  }) {
    const response = await this.client.get<ApiResponse<PaginatedResponse<ReportedComment>>>(
      '/admin/comments/reported',
      { params }
    )
    return response.data
  }

  /**
   * Resolve comment report
   */
  async resolveReport(reportId: number, status: 'resolved' | 'dismissed') {
    const response = await this.client.post<ApiResponse<null>>(
      `/admin/reports/${reportId}/resolve`,
      { status }
    )
    return response.data
  }

  /**
   * Delete comment (admin)
   */
  async deleteComment(commentId: number) {
    const response = await this.client.delete<ApiResponse<null>>(
      `/admin/comments/${commentId}`
    )
    return response.data
  }

  // ===== Analytics =====

  /**
   * Get platform statistics
   */
  async getPlatformStats() {
    const response = await this.client.get<ApiResponse<PlatformStats>>('/admin/stats')
    return response.data
  }

  /**
   * Get growth statistics
   */
  async getGrowthStats(days: number = 30) {
    const response = await this.client.get<ApiResponse<GrowthStats[]>>('/admin/stats/growth', {
      params: { days }
    })
    return response.data
  }
}
