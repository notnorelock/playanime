/**
 * Comment API Resource
 * Handles comment, reply, reaction, and report endpoints
 */

import { APIResource } from '../base'
import type {
  ApiResponse,
  PaginatedResponse,
  Comment,
  CommentReactionCount,
  CommentReport,
  ReactionEmoji
} from '@/types'

export class CommentResource extends APIResource {
  /**
   * Get comments for an episode
   */
  async getByEpisode(episodeId: number, params?: { page?: number; limit?: number }) {
    const response = await this.client.get<ApiResponse<PaginatedResponse<Comment>>>(
      `/comments/episode/${episodeId}`,
      { params }
    )
    return response.data
  }

  /**
   * Get a single comment with replies
   */
  async getById(commentId: number) {
    const response = await this.client.get<ApiResponse<Comment>>(`/comments/${commentId}`)
    return response.data
  }

  /**
   * Create a new comment on an episode
   */
  async create(data: { episode_id: number; content: string; parent_id?: number }) {
    const response = await this.client.post<Comment>(
      `/comments/episode/${data.episode_id}`,
      { content: data.content, parent_id: data.parent_id }
    )
    return response.data
  }

  /**
   * Reply to a comment
   */
  async reply(commentId: number, content: string) {
    const response = await this.client.post<Comment>(
      `/comments/${commentId}/reply`,
      { content }
    )
    return response.data
  }

  /**
   * Update a comment
   */
  async update(commentId: number, content: string) {
    const response = await this.client.put<Comment>(`/comments/${commentId}`, {
      content
    })
    return response.data
  }

  /**
   * Delete a comment
   */
  async delete(commentId: number) {
    await this.client.delete(`/comments/${commentId}`)
  }

  /**
   * Add reaction to a comment
   */
  async addReaction(commentId: number, emoji: ReactionEmoji) {
    await this.client.post(`/comments/${commentId}/react`, { emoji })
  }

  /**
   * Remove reaction from a comment
   */
  async removeReaction(commentId: number, emoji: ReactionEmoji) {
    await this.client.delete(`/comments/${commentId}/react/${emoji}`)
  }

  /**
   * Report a comment
   */
  async report(commentId: number, reason: string) {
    const response = await this.client.post<CommentReport>(
      `/comments/${commentId}/report`,
      { reason }
    )
    return response.data
  }
}
