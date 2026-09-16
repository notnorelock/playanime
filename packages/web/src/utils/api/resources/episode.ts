/**
 * Episode API Resource
 * Handles episode endpoints
 */

import { APIResource } from '../base'
import type { Episode, WatchProgress, Anime } from '@/types'

export class EpisodeResource extends APIResource {
  async getByAnimeId(animeId: string | number) {
    const response = await this.client.get<Episode[]>(`/anime/${animeId}/episodes`)
    return response.data
  }

  async getById(id: string | number) {
    const response = await this.client.get<Episode>(`/episodes/${id}`)
    return response.data
  }

  async updateProgress(episodeId: number, data: { progress_seconds: number; completed: boolean }) {
    const response = await this.client.put<WatchProgress>(`/episodes/${episodeId}/progress`, data)
    return response.data
  }

  async getProgress(episodeId: number) {
    const response = await this.client.get<WatchProgress>(`/episodes/${episodeId}/progress`)
    return response.data
  }

  async getContinueWatching() {
    const response = await this.client.get<Array<{ anime: Anime; episode: Episode; progress: WatchProgress }>>('/episodes/continue-watching')
    return response.data
  }
}
