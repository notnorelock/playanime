/**
 * Anime API Resource
 * Handles anime endpoints
 */

import { APIResource } from '../base'
import type { Anime, Genre, PaginationMeta } from '@/types'

interface AnimeListResponse {
  animes: Anime[]
  pagination: PaginationMeta
}

interface AnimeRatingInfo {
  anime_id: number
  average_rating: number
  total_ratings: number
}

export class AnimeResource extends APIResource {
  async getAll(params?: {
    page?: number
    limit?: number
    search?: string
    genres?: string[]
    year?: number
    status?: string
    sort_by?: string
  }) {
    const response = await this.client.get<AnimeListResponse>('/anime', { params })
    return response.data
  }

  async getById(id: string | number) {
    const response = await this.client.get<Anime>(`/anime/${id}`)
    return response.data
  }

  async getTrending(limit: number = 10) {
    const response = await this.client.get<Anime[]>('/anime/trending', {
      params: { limit }
    })
    return response.data
  }

  async getGenres() {
    const response = await this.client.get<Genre[]>('/anime/genres')
    return response.data
  }

  async getRating(animeId: number) {
    const response = await this.client.get<AnimeRatingInfo>('/anime/rating', {
      params: { anime_id: animeId }
    })
    return response.data
  }

  async getFavorites() {
    const response = await this.client.get<Anime[]>('/anime/favorites')
    return response.data
  }

  async addFavorite(animeId: number) {
    const response = await this.client.post<{ success: boolean }>('/anime/favorites', {
      anime_id: animeId
    })
    return response.data
  }

  async removeFavorite(animeId: number) {
    const response = await this.client.delete<{ success: boolean }>('/anime/favorites', {
      params: { anime_id: animeId }
    })
    return response.data
  }

  async rate(animeId: number, rating: number) {
    const response = await this.client.post<{ success: boolean }>('/anime/rate', {
      anime_id: animeId,
      rating
    })
    return response.data
  }
}
