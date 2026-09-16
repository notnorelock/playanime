/**
 * User Profile type definitions
 */

export interface UserProfile {
  id: number
  username: string
  email: string
  avatar_url?: string
  bio?: string
  created_at: string
  updated_at: string
  // Statistics
  stats?: UserStats
}

export interface UserStats {
  total_watch_time: number // in minutes
  anime_watched: number
  episodes_watched: number
  comments_count: number
  ratings_count: number
  favorites_count: number
}

export interface WatchHistory {
  id: number
  user_id: number
  episode_id: number
  anime_id: number
  progress: number // seconds
  completed: boolean
  watched_at: string
  // Relations
  anime?: {
    id: number
    title: string
    poster_url?: string
  }
  episode?: {
    id: number
    episode_number: number
    title: string
  }
}

export interface UserComment {
  id: number
  episode_id: number
  content: string
  created_at: string
  // Relations
  anime?: {
    id: number
    title: string
  }
  episode?: {
    id: number
    episode_number: number
    title: string
  }
}

export interface UserRating {
  id: number
  episode_id: number
  rating: number // 0-5 scale
  created_at: string
  // Relations
  anime?: {
    id: number
    title: string
  }
  episode?: {
    id: number
    episode_number: number
    title: string
  }
}
