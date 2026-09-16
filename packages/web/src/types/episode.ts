/**
 * Episode-related type definitions
 */

export interface Episode {
  id: number
  anime_id: number
  episode_number: number
  title: string
  synopsis?: string
  thumbnail_url: string
  duration_seconds: number
  intro_start?: number
  intro_end?: number
  translator_notes?: string
  created_at: string
  updated_at: string

  // Relations (optional)
  sources?: EpisodeSource[]
}

export interface EpisodeSource {
  id: number
  episode_id: number
  source_name: string
  source_url: string
  quality: string // e.g., '720p', '1080p'
  language: string // e.g., 'pl', 'en'
  created_at: string
}
