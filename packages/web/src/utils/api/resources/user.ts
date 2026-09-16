/**
 * User API Resource
 * Handles user profile and data endpoints
 */

import { APIResource } from '../base'
import type { User, Anime, WatchProgress } from '@/types'

interface UserRating {
  anime_id: number
  rating: number
  updated_at: string
}

export class UserResource extends APIResource {
  async getProfile(userId?: number) {
    const response = await this.client.get<User>(`/users/${userId || 'me'}`)
    return response.data
  }

  async updateProfile(data: Partial<User>) {
    const response = await this.client.put<User>('/users/me', data)
    return response.data
  }

  // Watch Progress endpoints
  async updateWatchProgress(data: {
    anime_id: number
    episode_id: number
    progress_seconds: number
    completed: boolean
  }) {
    const response = await this.client.post<{ success: boolean }>('/user/progress', data)
    return response.data
  }

  async getWatchProgress(episodeId: number) {
    const response = await this.client.get<WatchProgress>('/user/progress', {
      params: { episode_id: episodeId }
    })
    return response.data
  }

  async getWatchHistory(limit: number = 20) {
    const response = await this.client.get<WatchProgress[]>('/user/history', {
      params: { limit }
    })
    return response.data
  }

  async getAnimeWatchProgress(animeId: number) {
    const response = await this.client.get<WatchProgress[]>('/user/progress/anime', {
      params: { anime_id: animeId }
    })
    return response.data
  }

  // Rating endpoints
  async getMyRating(animeId: number) {
    const response = await this.client.get<UserRating>('/user/rating', {
      params: { anime_id: animeId }
    })
    return response.data
  }

  async getMyRatings() {
    const response = await this.client.get<UserRating[]>('/user/ratings')
    return response.data
  }

  async deleteRating(animeId: number) {
    const response = await this.client.delete<{ success: boolean }>('/user/rating', {
      params: { anime_id: animeId }
    })
    return response.data
  }

  async getFavorites() {
    const response = await this.client.get<Anime[]>('/anime/favorites')
    return response.data
  }
}
