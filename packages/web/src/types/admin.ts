/**
 * Admin Panel type definitions
 */

export interface PlatformStats {
  total_users: number
  active_users: number
  total_anime: number
  pending_anime: number
  total_episodes: number
  total_translators: number
  verified_translators: number
  total_comments: number
  pending_reports: number
}

export interface GrowthStats {
  date: string
  new_users: number
  new_anime: number
  new_episodes: number
  new_comments: number
  total_watch_time: number // in minutes
}

export interface UserBan {
  id: number
  user_id: number
  banned_by: number
  reason: string
  expires_at?: string
  created_at: string
  updated_at: string
  // Relations
  user?: {
    id: number
    username: string
    email: string
  }
  banned_by_user?: {
    id: number
    username: string
  }
}

export interface AdminUser {
  id: number
  username: string
  email: string
  created_at: string
  is_active: boolean
  // Relations
  roles?: {
    id: number
    name: string
  }[]
  ban?: UserBan
}

export interface ReportedComment {
  id: number
  comment_id: number
  reporter_id: number
  reason: string
  status: 'pending' | 'resolved' | 'dismissed'
  resolved_by?: number
  resolved_at?: string
  created_at: string
  // Relations
  comment?: {
    id: number
    content: string
    episode_id: number
    user_id: number
  }
  reporter?: {
    id: number
    username: string
  }
  resolver?: {
    id: number
    username: string
  }
}

export interface PendingAnime {
  id: number
  title: string
  translator_group_id: number
  created_at: string
  // Relations
  translator_group?: {
    id: number
    name: string
  }
}

export interface PendingTranslator {
  id: number
  name: string
  description?: string
  website_url?: string
  created_at: string
  is_verified: boolean
  verified_by?: number
  verified_at?: string
  // Relations
  leader?: {
    id: number
    username: string
  }
  members_count?: number
  anime_count?: number
}
