/**
 * Video player-related type definitions
 */

export interface VideoPlayerOptions {
  autoplay?: boolean
  controls?: boolean
  fluid?: boolean
  responsive?: boolean
  aspectRatio?: string
}

export interface VideoSource {
  src: string
  type: string
  label?: string
}
