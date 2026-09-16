/**
 * Rating API Resource
 * Handles episode and anime rating endpoints
 */

import { APIResource } from '../base'
import type {
  ApiResponse,
  PaginatedResponse,
  EpisodeRating,
  EpisodeStats,
  AnimeRatingStats,
  TopRatedEpisode
} from '@/types'

export class RatingResource extends APIResource {
  /**
   * Rate an episode (0-5 scale)
   * @param episodeId - Episode ID
   * @param rating - Rating value between 0 and 5
   */
  async rateEpisode(episodeId: number, rating: number) {
    const response = await this.client.post<EpisodeRating>(
      `/rating/episode/${episodeId}/rate`,
      { rating }
    )
    return response.data
  }

  /**
   * Get user's rating for an episode
   */
  async getUserRating(episodeId: number) {
    const response = await this.client.get<EpisodeRating>(
      `/rating/episode/${episodeId}/rating/me`
    )
    return response.data
  }

  /**
   * Get episode statistics
   */
  async getEpisodeStats(episodeId: number) {
    const response = await this.client.get<EpisodeStats>(
      `/rating/episode/${episodeId}/stats`
    )
    return response.data
  }

  /**
   * Get top-rated episodes for an anime
   */
  async getTopRatedEpisodes(animeId: number) {
    const response = await this.client.get<TopRatedEpisode[]>(
      `/rating/anime/${animeId}/top-episodes`
    )
    return response.data
  }
}
