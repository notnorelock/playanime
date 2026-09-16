/**
 * Translator-related type definitions
 */

export interface TranslatorGroup {
  id: number
  name: string
  slug: string
  avatar: string
  bio: string
  website?: string
  is_verified: boolean
  verified_at?: string
  verified_by?: number
  created_at: string
  updated_at: string

  // Relations (optional)
  members?: TranslatorMember[]
  social_links?: SocialLink[]
  stats?: TranslatorStats
}

export interface TranslatorMember {
  id: number
  group_id: number
  user_id: number
  role_id: number
  joined_at: string
}

export interface SocialLink {
  id: number
  translator_id: number
  platform: string
  url: string
}

export interface TranslatorStats {
  translator_id: number
  anime_count: number
  total_views: number
  total_likes: number
  updated_at: string
}

// Legacy type alias for backwards compatibility
export interface Translator extends TranslatorGroup {}

export interface SocialLinks {
  twitter?: string
  discord?: string
  youtube?: string
  patreon?: string
}
