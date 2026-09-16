/**
 * Watch Together Player Sync Composable
 * Handles syncing player state with watch together sessions
 */

import { type Ref, type ComputedRef } from 'vue'

interface VideoPlayerRef {
  currentTime: Ref<number>
  isPlaying: Ref<boolean>
  remoteSync: (time: number, playing: boolean) => void
  remotePlay: () => void
  remotePause: () => void
}

interface WatchTogetherManager {
  latency: Ref<number>
}

interface WatchTogetherRoomInstance {
  wtManager: WatchTogetherManager
}

interface PlayerSyncState {
  playing: boolean
  currentTime: number
}

export function useWatchTogetherPlayerSync(
  videoPlayerRef: Ref<VideoPlayerRef | null>,
  watchTogetherRoom: Ref<WatchTogetherRoomInstance | null>
) {
  /**
   * Handle player sync event from watch together room
   */
  const handlePlayerSync = (state: PlayerSyncState): void => {
    console.log('[WatchTogetherPlayerSync] Received sync from room:', state)

    if (!videoPlayerRef.value || !watchTogetherRoom.value) {
      console.warn('[WatchTogetherPlayerSync] Missing refs - skipping sync')
      return
    }

    // Get network latency
    const wtManager = watchTogetherRoom.value.wtManager
    const latency = wtManager?.latency.value || 0

    // Compensate for network latency if playing
    // Add latency/1000 to current time to account for transmission delay
    const compensatedTime = state.playing
      ? state.currentTime + (latency / 1000)
      : state.currentTime

    // Get current player time
    const currentPlayerTime = videoPlayerRef.value.currentTime?.value ?? 0
    const timeDifference = Math.abs(compensatedTime - currentPlayerTime)

    // Dynamic sync threshold based on network latency
    // We need to be VERY tolerant to prevent constant buffering from seeking
    const latencySeconds = latency / 1000 // convert ms to seconds

    // CRITICAL: Only seek when difference is significant (>2s) to avoid buffering
    // For small differences, let natural playback handle it
    const CRITICAL_THRESHOLD = 2.0 // Only seek if >2 seconds out of sync

    // Tolerance threshold - acceptable drift without any action
    // This accounts for network latency, jitter, and natural playback variance
    const TOLERANCE_THRESHOLD = Math.max(
      1.0, // Minimum 1 second tolerance
      latencySeconds * 6, // 6x latency for network variance
      0.5 // Account for periodic sync interval (2s) and playback drift
    )

    console.log('[WatchTogetherPlayerSync] Sync decision:', {
      originalTime: state.currentTime,
      latency: latency,
      latencySeconds: latencySeconds.toFixed(3),
      compensatedTime: compensatedTime.toFixed(2),
      currentPlayerTime: currentPlayerTime.toFixed(2),
      timeDifference: timeDifference.toFixed(3),
      toleranceThreshold: TOLERANCE_THRESHOLD.toFixed(3),
      criticalThreshold: CRITICAL_THRESHOLD.toFixed(3),
      needsCriticalSync: timeDifference > CRITICAL_THRESHOLD,
      withinTolerance: timeDifference <= TOLERANCE_THRESHOLD,
      playing: state.playing
    })

    // Three-tier sync strategy to minimize buffering:
    // 1. CRITICAL (>2s): Must seek - user experience is too degraded
    // 2. TOLERANCE (>1s but <2s): Only sync play/pause state, let playback naturally catch up
    // 3. ACCEPTABLE (<1s): Do nothing - within acceptable drift

    if (timeDifference > CRITICAL_THRESHOLD) {
      // Difference is too large - must seek despite buffering cost
      console.log('[WatchTogetherPlayerSync] CRITICAL: Time difference >', CRITICAL_THRESHOLD, 's - seeking')
      videoPlayerRef.value.remoteSync(compensatedTime, state.playing)
    } else if (timeDifference > TOLERANCE_THRESHOLD) {
      // Moderate difference - sync play state only, let natural playback handle time drift
      console.log('[WatchTogetherPlayerSync] MODERATE: Time difference >', TOLERANCE_THRESHOLD, 's - syncing play state only (no seek)')
      const isCurrentlyPlaying = videoPlayerRef.value.isPlaying?.value ?? false
      if (state.playing !== isCurrentlyPlaying) {
        if (state.playing) {
          videoPlayerRef.value.remotePlay()
        } else {
          videoPlayerRef.value.remotePause()
        }
      } else {
        console.log('[WatchTogetherPlayerSync] Play state matches - letting natural playback catch up')
      }
    } else {
      // Within tolerance - only sync play/pause if needed, never seek
      const isCurrentlyPlaying = videoPlayerRef.value.isPlaying?.value ?? false
      if (state.playing !== isCurrentlyPlaying) {
        console.log('[WatchTogetherPlayerSync] MINOR: Time within tolerance, syncing play state only')
        if (state.playing) {
          videoPlayerRef.value.remotePlay()
        } else {
          videoPlayerRef.value.remotePause()
        }
      } else {
        console.log('[WatchTogetherPlayerSync] GOOD: In sync - no action needed (diff:', timeDifference.toFixed(3), 's)')
      }
    }
  }

  return {
    handlePlayerSync
  }
}
