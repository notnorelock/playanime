/**
 * Translator API Resource
 * Handles translator group endpoints
 */

import { APIResource } from '../base'
import type {
  TranslatorGroup,
  Anime,
  PaginationMeta,
  PaginationParams,
  BackendPaginatedResponse
} from '@/types'

// Frontend response interfaces
interface TranslatorListResponse {
  translators: TranslatorGroup[]
  pagination: PaginationMeta
}

interface TranslatorAnimesResponse {
  animes: Anime[]
  pagination: PaginationMeta
}

export class TranslatorResource extends APIResource {
  /**
   * Get all translator groups with pagination
   */
  async getAll(params?: PaginationParams): Promise<TranslatorListResponse> {
    const response = await this.client.get<BackendPaginatedResponse<TranslatorGroup>>('/translators', { params })
    const result = response.data
    // Transform backend paginated response to expected format
    return {
      translators: result.data,
      pagination: {
        page: result.pagination.page,
        limit: result.pagination.limit,
        total_count: result.pagination.total_count,
        total_pages: result.pagination.total_pages
      }
    }
  }

  /**
   * Get translator group by ID
   */
  async getById(id: string | number) {
    const response = await this.client.get<TranslatorGroup>(`/translators/${id}`)
    return response.data
  }

  /**
   * Get all anime from a translator group
   */
  async getGroupAnimes(id: string | number, params?: PaginationParams): Promise<TranslatorAnimesResponse> {
    const response = await this.client.get<BackendPaginatedResponse<Anime>>(
      `/translators/${id}/anime`,
      { params }
    )
    const result = response.data
    // Transform backend paginated response to expected format
    return {
      animes: result.data,
      pagination: {
        page: result.pagination.page,
        limit: result.pagination.limit,
        total_count: result.pagination.total_count,
        total_pages: result.pagination.total_pages
      }
    }
  }

  /**
   * Create a new translator group (requires authentication)
   */
  async create(data: Partial<TranslatorGroup>) {
    const response = await this.client.post<TranslatorGroup>('/translators', data)
    return response.data
  }

  /**
   * Update translator group (requires authentication)
   */
  async update(id: string | number, data: Partial<TranslatorGroup>) {
    const response = await this.client.put<TranslatorGroup>(`/translators/${id}`, data)
    return response.data
  }

  /**
   * Delete translator group (requires authentication)
   */
  async delete(id: string | number) {
    await this.client.delete(`/translators/${id}`)
  }

  /**
   * Verify translator group (requires admin/moderator)
   */
  async verify(id: string | number) {
    const response = await this.client.post<{ message: string }>(
      `/translators/${id}/verify`
    )
    return response.data
  }

  /**
   * Add member to translator group (requires authentication)
   */
  async addMember(groupId: string | number, userId: number, roleId: number) {
    const response = await this.client.post<{ message: string }>(
      `/translators/${groupId}/members`,
      { user_id: userId, role_id: roleId }
    )
    return response.data
  }

  /**
   * Remove member from translator group (requires authentication)
   */
  async removeMember(groupId: string | number, userId: number) {
    await this.client.delete(`/translators/${groupId}/members/${userId}`)
  }

  /**
   * Update member role in translator group (requires authentication)
   */
  async updateMemberRole(groupId: string | number, userId: number, roleId: number) {
    const response = await this.client.put<{ message: string }>(
      `/translators/${groupId}/members/${userId}/role`,
      { role_id: roleId }
    )
    return response.data
  }
}
