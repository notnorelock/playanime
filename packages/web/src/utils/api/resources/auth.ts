/**
 * Auth API Resource
 * Handles authentication endpoints
 */

import { APIResource } from '../base'
import type { User } from '@/types'

export class AuthResource extends APIResource {
  async register(data: { email: string; username: string; password: string }) {
    const response = await this.client.post<{ user: User; token: string }>('/auth/register', data)
    return response.data
  }

  async login(data: { email_or_username: string; password: string }) {
    const response = await this.client.post<{ user: User; token: string }>('/auth/login', data)
    return response.data
  }

  async me() {
    const response = await this.client.get<User>('/auth/me')
    return response.data
  }

  async logout() {
    await this.client.post('/auth/logout')
  }
}
