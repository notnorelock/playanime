/**
 * User-related type definitions
 */

import type { Anime } from './anime'
import type { Episode } from './episode'
import type { UserBan } from './admin'

export interface User {
  id: number
  email: string
  username: string
  avatar?: string
  bio?: string
  is_active: boolean
  last_login_at?: string
  created_at: string
  updated_at: string

  // Relations (optional)
  roles?: string[]
  bans?: UserBan[]
}

export interface Role {
  id: number
  name: string
  slug: string
  description: string
  level: number
  is_system: boolean
  created_at: string
  updated_at: string
}

export interface UserRating {
  user_id: number
  anime_id: number
  rating: number // 0-5
  created_at: string
  updated_at: string
}

export interface UserPreferences {
  theme: 'light' | 'dark' | 'auto'
  language: 'pl' | 'en'
  autoplay: boolean
  subtitleLanguage: string
  videoQuality: string
}

export interface WatchProgress {
  user_id: number
  anime_id: number
  episode_id: number
  progress_seconds: number
  completed: boolean
  updated_at: string
}

export interface ContinueWatching {
  anime: Anime
  episode: Episode
  progress: WatchProgress
}
