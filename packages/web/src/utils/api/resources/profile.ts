/**
 * Profile API Resource
 * Handles user profile and statistics endpoints
 */

import { APIResource } from '../base'
import type {
  ApiResponse,
  PaginatedResponse,
  UserProfile,
  UserStats,
  WatchHistory,
  UserComment,
  UserRating
} from '@/types'

export class ProfileResource extends APIResource {
  /**
   * Get user profile by username
   */
  async getByUsername(username: string) {
    const response = await this.client.get<ApiResponse<UserProfile>>(`/users/${username}`)
    return response.data
  }

  /**
   * Get user statistics
   */
  async getStats(username: string) {
    const response = await this.client.get<ApiResponse<UserStats>>(`/users/${username}/stats`)
    return response.data
  }

  /**
   * Get user's watch history
   */
  async getWatchHistory(username: string, params?: { page?: number; limit?: number }) {
    const response = await this.client.get<ApiResponse<PaginatedResponse<WatchHistory>>>(
      `/users/${username}/watch-history`,
      { params }
    )
    return response.data
  }

  /**
   * Get user's comments
   */
  async getComments(username: string, params?: { page?: number; limit?: number }) {
    const response = await this.client.get<ApiResponse<PaginatedResponse<UserComment>>>(
      `/users/${username}/comments`,
      { params }
    )
    return response.data
  }

  /**
   * Get user's ratings
   */
  async getRatings(username: string, params?: { page?: number; limit?: number }) {
    const response = await this.client.get<ApiResponse<PaginatedResponse<UserRating>>>(
      `/users/${username}/ratings`,
      { params }
    )
    return response.data
  }
}
