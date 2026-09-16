/**
 * Rating type definitions
 */

export interface EpisodeRating {
  id: number
  episode_id: number
  user_id: number
  rating: number // 0-5 scale
  created_at: string
  updated_at: string
}

export interface EpisodeStats {
  id: number
  episode_id: number
  average_rating: number
  total_ratings: number
  view_count: number
  comment_count: number
  updated_at: string
}

export interface AnimeRatingStats {
  anime_id: number
  average_rating: number
  total_ratings: number
  episode_count: number
}

export interface TopRatedEpisode {
  id: number
  anime_id: number
  anime_title: string
  episode_number: number
  title: string
  average_rating: number
  total_ratings: number
}
