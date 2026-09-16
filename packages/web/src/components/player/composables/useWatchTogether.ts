/**
 * Watch Together Composable
 * Handles synchronization of player state in watch together mode
 */

import { ref, watch, onUnmounted, type Ref } from 'vue'

export interface PlayerAction {
  type: 'play' | 'pause' | 'seek'
  playing: boolean
  currentTime: number
}

interface VideoElement {
  currentTime: number
  paused: boolean
  readyState: number
  duration: number
  src: string
  play: () => Promise<void>
  pause: () => void
}

interface PlayerControls {
  play: () => Promise<void>
  pause: () => void
}

export function useWatchTogether(
  isPlaying: Ref<boolean>,
  currentTime: Ref<number>,
  duration: Ref<number>,
  watchTogetherMode: Ref<boolean>,
  isHost: Ref<boolean>,
  videoElement: Ref<HTMLVideoElement | undefined>,
  playerControls: PlayerControls,
  emitAction: (action: PlayerAction) => void
) {
  const isRemoteAction = ref(false)
  const syncInterval = ref<number | null>(null)

  /**
   * Emit a player action if in watch together mode and user is host
   */
  const emitPlayerAction = (type: 'play' | 'pause' | 'seek') => {
    if (watchTogetherMode.value && isHost.value && !isRemoteAction.value) {
      console.log('[WatchTogether] Emitting player action (as host):', {
        type,
        playing: isPlaying.value,
        currentTime: currentTime.value
      })
      emitAction({
        type,
        playing: isPlaying.value,
        currentTime: currentTime.value
      })
    } else if (watchTogetherMode.value && !isHost.value) {
      console.log('[WatchTogether] Ignoring player action (not host):', type)
    }
  }

  /**
   * Start periodic sync updates (every 2 seconds while playing)
   */
  const startPeriodicSync = () => {
    if (!watchTogetherMode.value || !isHost.value) return

    stopPeriodicSync() // Clear any existing interval

    syncInterval.value = window.setInterval(() => {
      if (isPlaying.value && !isRemoteAction.value) {
        console.log('[WatchTogether] Periodic sync update')
        emitPlayerAction('seek') // Send current position
      }
    }, 2000)
  }

  /**
   * Stop periodic sync updates
   */
  const stopPeriodicSync = () => {
    if (syncInterval.value) {
      clearInterval(syncInterval.value)
      syncInterval.value = null
    }
  }

  /**
   * Set remote action flag temporarily to prevent sync loops
   */
  const setRemoteAction = (callback: () => void) => {
    console.log('[WatchTogether] Setting remote action flag')
    isRemoteAction.value = true

    try {
      callback()
    } catch (error) {
      console.error('[WatchTogether] Error in remote action callback:', error)
    }

    // Keep flag set longer to ensure async operations complete
    setTimeout(() => {
      isRemoteAction.value = false
      console.log('[WatchTogether] Remote action flag cleared')
    }, 200)
  }

  // Watch isPlaying to manage periodic sync
  watch(isPlaying, (playing) => {
    // Only manage sync if we're the host and this isn't a remote action
    if (watchTogetherMode.value && isHost.value && !isRemoteAction.value) {
      console.log('[WatchTogether] isPlaying changed to:', playing, '(managing periodic sync)')
      if (playing) {
        startPeriodicSync()
      } else {
        stopPeriodicSync()
      }
    } else if (isRemoteAction.value) {
      console.log('[WatchTogether] isPlaying changed to:', playing, '(remote action, skipping sync management)')
    }
  })

  // Cleanup on unmount
  onUnmounted(() => {
    stopPeriodicSync()
  })

  /**
   * Remote control methods (called from watch together sync)
   */
  const remotePlay = () => {
    console.log('[WatchTogether] Remote play triggered')
    setRemoteAction(() => {
      playerControls.play()
      console.log('[WatchTogether] Playing state after remote play:', isPlaying.value)
    })
  }

  const remotePause = () => {
    console.log('[WatchTogether] Remote pause triggered')
    setRemoteAction(() => {
      playerControls.pause()
      console.log('[WatchTogether] Playing state after remote pause:', isPlaying.value)
    })
  }

  const remoteSeek = (timeInSeconds: number) => {
    console.log('[WatchTogether] Remote seek triggered to time:', timeInSeconds, 'current duration:', duration.value)
    setRemoteAction(() => {
      if (videoElement.value) {
        videoElement.value.currentTime = timeInSeconds
        currentTime.value = timeInSeconds
        console.log('[WatchTogether] Seeked to time:', timeInSeconds)
      }
    })
  }

  const remoteSync = (timeInSeconds: number, shouldPlay: boolean) => {
    console.log('[WatchTogether] Remote sync triggered - time:', timeInSeconds, 'playing:', shouldPlay)
    console.log('[WatchTogether] Current state before sync - videoElement exists:', !!videoElement.value, 'duration:', duration.value, 'currentTime:', currentTime.value, 'isPlaying:', isPlaying.value)

    setRemoteAction(() => {
      if (!videoElement.value) {
        console.error('[WatchTogether] No video element available')
        return
      }

      console.log('[WatchTogether] Video element state:', {
        readyState: videoElement.value.readyState,
        paused: videoElement.value.paused,
        currentTime: videoElement.value.currentTime,
        duration: videoElement.value.duration,
        src: videoElement.value.src?.substring(0, 50)
      })

      // Directly set the time on the video element
      console.log('[WatchTogether] Setting currentTime from', videoElement.value.currentTime, 'to', timeInSeconds)
      videoElement.value.currentTime = timeInSeconds
      currentTime.value = timeInSeconds

      // Apply playing state immediately
      if (shouldPlay && videoElement.value.paused) {
        console.log('[WatchTogether] Video is paused but should play - calling play()')
        videoElement.value.play()
          .then(() => {
            isPlaying.value = true
            console.log('[WatchTogether] Play successful - isPlaying set to true')
          })
          .catch((error) => {
            console.error('[WatchTogether] Play failed:', error)
          })
      } else if (!shouldPlay && !videoElement.value.paused) {
        console.log('[WatchTogether] Video is playing but should pause - calling pause()')
        videoElement.value.pause()
        isPlaying.value = false
        console.log('[WatchTogether] Pause successful - isPlaying set to false')
      } else {
        console.log('[WatchTogether] No state change needed. shouldPlay:', shouldPlay, 'video.paused:', videoElement.value.paused)
      }

      console.log('[WatchTogether] Sync complete - final state:', {
        currentTime: currentTime.value,
        isPlaying: isPlaying.value,
        videoPaused: videoElement.value.paused,
        videoCurrentTime: videoElement.value.currentTime
      })
    })
  }

  return {
    isRemoteAction,
    emitPlayerAction,
    startPeriodicSync,
    stopPeriodicSync,
    setRemoteAction,
    remotePlay,
    remotePause,
    remoteSeek,
    remoteSync
  }
}
