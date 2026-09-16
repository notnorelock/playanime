/**
 * Comment type definitions
 */

export interface Comment {
  id: number
  episode_id: number
  user_id: number
  parent_id: number | null
  content: string
  created_at: string
  updated_at: string
  // Relations
  user?: {
    id: number
    username: string
    avatar_url?: string
  }
  replies?: Comment[]
  reactions?: CommentReaction[]
  user_reaction?: string // Current user's reaction emoji
}

export interface CommentReaction {
  id: number
  comment_id: number
  user_id: number
  emoji: string
  created_at: string
}

export interface CommentReactionCount {
  emoji: string
  count: number
  user_reacted: boolean
}

export interface CommentReport {
  id: number
  comment_id: number
  reporter_id: number
  reason: string
  status: 'pending' | 'resolved' | 'dismissed'
  resolved_by?: number
  resolved_at?: string
  created_at: string
  updated_at: string
}

export type ReactionEmoji = '👍' | '❤️' | '😂' | '😮' | '😢' | '😡' | '🔥' | '🎉'

export const AVAILABLE_REACTIONS: ReactionEmoji[] = ['👍', '❤️', '😂', '😮', '😢', '😡', '🔥', '🎉']
