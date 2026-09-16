/**
 * Watch Together API Resource
 * Handles watch together session endpoints
 */

import { APIResource } from '../base'

export interface Session {
  roomId: string
  animeId: number
  episodeId: number
  memberCount: number
  host: number
  createdAt: string
}

export interface SessionsResponse {
  sessions: Session[]
  count: number
}

export interface SessionsByAnimeParams {
  animeId: number
  episodeId?: number
}

export class WatchTogetherResource extends APIResource {
  /**
   * Get all active watch together sessions
   */
  async getSessions() {
    const response = await this.client.get<SessionsResponse>('/watchtogether/sessions')
    return response.data
  }

  /**
   * Get sessions for a specific anime/episode
   */
  async getSessionsByAnime(params: SessionsByAnimeParams) {
    const queryParams: Record<string, string> = {
      animeId: params.animeId.toString()
    }

    if (params.episodeId !== undefined) {
      queryParams.episodeId = params.episodeId.toString()
    }

    const response = await this.client.get<SessionsResponse>('/watchtogether/sessions/anime', {
      params: queryParams
    })
    return response.data
  }
}
