/**
 * API Client
 * Main entry point with dynamic resource loading
 */

import axios, { type AxiosInstance, type AxiosError, type InternalAxiosRequestConfig } from 'axios'
import type { APIResource } from './base'
import { versionInfoSingleton } from '@/composables/useVersion'

// API Base URL
const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8080/api/v1'

// Create Axios instance
const axiosInstance: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json'
  },
  withCredentials: false // Changed to false since we're passing token explicitly
})

// Request interceptor - add auth token and version info
axiosInstance.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    // Add auth token
    const token = localStorage.getItem('auth_token')
    if (token && config.headers) {
      config.headers.Authorization = `Bearer ${token}`
    }

    // Add client version info from singleton
    if (versionInfoSingleton.value && config.headers) {
      config.headers['X-Client-Version'] = versionInfoSingleton.value.version
      config.headers['X-Client-Commit'] = versionInfoSingleton.value.commitHash
    }

    return config
  },
  (error) => {
    return Promise.reject(error)
  }
)

// Response interceptor - unwrap backend response and handle errors globally
axiosInstance.interceptors.response.use(
  (response) => {
    // Unwrap the backend's {success, data} wrapper
    if (response.data && typeof response.data === 'object' && 'success' in response.data && 'data' in response.data) {
      response.data = response.data.data
    }
    return response
  },
  (error: AxiosError) => {
    if (error.response) {
      switch (error.response.status) {
        case 403:
          console.error('Forbidden - insufficient permissions')
          break
        case 404:
          console.error('Resource not found')
          break
        case 500:
          console.error('Server error')
          break
        default:
          console.error('API Error:', error.response.data)
      }
    } else if (error.request) {
      console.error('Network error - no response received')
    } else {
      console.error('Request error:', error.message)
    }
    return Promise.reject(error)
  }
)

// Resource cache
const resourceCache = new Map<string, APIResource>()

// Resource loader map
const resourceLoaders: Record<string, () => Promise<any>> = {
  auth: () => import('./resources/auth').then(m => m.AuthResource),
  anime: () => import('./resources/anime').then(m => m.AnimeResource),
  episode: () => import('./resources/episode').then(m => m.EpisodeResource),
  user: () => import('./resources/user').then(m => m.UserResource),
  translator: () => import('./resources/translator').then(m => m.TranslatorResource),
  rating: () => import('./resources/rating').then(m => m.RatingResource),
  comment: () => import('./resources/comment').then(m => m.CommentResource),
  profile: () => import('./resources/profile').then(m => m.ProfileResource),
  admin: () => import('./resources/admin').then(m => m.AdminResource),
  watchtogether: () => import('./resources/watchtogether').then(m => m.WatchTogetherResource)
}

/**
 * API Client Class
 * Provides dynamic resource loading and command execution
 */
class APIClient {
  private client: AxiosInstance

  constructor(client: AxiosInstance) {
    this.client = client
  }

  /**
   * Load a resource dynamically
   * @param resourceName Name of the resource to load
   */
  private async loadResource(resourceName: string): Promise<APIResource> {
    // Check cache first
    if (resourceCache.has(resourceName)) {
      return resourceCache.get(resourceName)!
    }

    // Load resource dynamically
    const loader = resourceLoaders[resourceName]
    if (!loader) {
      throw new Error(`Resource '${resourceName}' not found`)
    }

    const ResourceClass = await loader()
    const resource = new ResourceClass(this.client)
    resourceCache.set(resourceName, resource)

    return resource
  }

  /**
   * Execute a command on a resource
   * Usage: api.command('auth', 'login', { email, password })
   * @param resourceName Resource name (e.g., 'auth', 'anime')
   * @param commandName Command name (method name on the resource)
   * @param args Arguments to pass to the command
   */
  async command<T = any>(resourceName: string, commandName: string, ...args: any[]): Promise<T> {
    const resource = await this.loadResource(resourceName)
    return resource.execute<T>(commandName, ...args)
  }

  /**
   * Get a resource instance for direct method calls
   * Usage: const auth = await api.resource('auth'); await auth.login(...)
   * @param resourceName Resource name
   */
  async resource<T extends APIResource = APIResource>(resourceName: string): Promise<T> {
    return this.loadResource(resourceName) as Promise<T>
  }

  /**
   * Clear resource cache (useful for testing)
   */
  clearCache() {
    resourceCache.clear()
  }

  /**
   * Get the underlying Axios instance for custom requests
   */
  get axios() {
    return this.client
  }
}

// Create and export singleton API client
export const api = new APIClient(axiosInstance)

// Export axios instance for direct use if needed
export { axiosInstance as axios }

// Export default
export default api
