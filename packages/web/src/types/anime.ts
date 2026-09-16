/**
 * Anime-related type definitions
 */

import type { Genre } from './genre'
import type { Episode } from './episode'
import type { TranslatorGroup } from './translator'
import type { User } from './user'

export interface Anime {
  id: number
  title: string
  title_english?: string
  title_japanese?: string
  synopsis: string
  description: string
  cover_image: string
  banner_image: string
  thumbnail_url: string
  cover_url: string
  studio?: string
  status: AnimeStatus
  release_year: number
  total_episodes: number
  duration?: number
  translator_id?: number
  is_approved: boolean
  approved_at?: string
  approved_by?: number
  created_at: string
  updated_at: string

  // Relations (optional)
  translator?: TranslatorGroup
  approver?: User
  genres?: Genre[]
  episodes?: Episode[]
  stats?: AnimeStats
}

export type AnimeStatus = 'ongoing' | 'finished' | 'upcoming'

export interface AnimeStats {
  anime_id: number
  view_count: number
  favorite_count: number
  average_rating: number
  rating_count: number
  updated_at: string
}

export interface TrendingAnime extends Anime {
  trendingScore: number
  weeklyViews: number
}

export interface FeaturedAnime extends Anime {
  featuredReason: string
  featuredImage: string
}

export interface AnimeFilters {
  genres?: string[]
  status?: AnimeStatus
  year?: number
  minRating?: number
  sortBy?: AnimeSortBy
  sortOrder?: 'asc' | 'desc'
}

export type AnimeSortBy = 'title' | 'rating' | 'releaseYear' | 'views' | 'newest'

export interface SearchQuery {
  query: string
  filters?: AnimeFilters
  page?: number
  pageSize?: number
}
