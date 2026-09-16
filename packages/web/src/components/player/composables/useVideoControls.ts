/**
 * Video Controls Composable
 * Handles playback, volume, seeking, and playback rate controls
 */

import { ref, type Ref } from 'vue'

export function useVideoControls(videoElement: Ref<HTMLVideoElement | undefined>) {
  const isPlaying = ref(false)
  const isMuted = ref(false)
  const currentTime = ref(0)
  const duration = ref(0)
  const volume = ref(1)
  const playbackRate = ref(1)

  const playbackRates = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]

  // Playback controls
  const togglePlay = () => {
    if (!videoElement.value) return

    if (isPlaying.value) {
      pause()
    } else {
      play()
    }
  }

  const play = async () => {
    if (videoElement.value) {
      try {
        await videoElement.value.play()
        isPlaying.value = true
      } catch (error) {
        console.error('Play error:', error)
      }
    }
  }

  const pause = () => {
    if (videoElement.value) {
      videoElement.value.pause()
      isPlaying.value = false
    }
  }

  // Volume controls
  const toggleMute = () => {
    if (!videoElement.value) return
    videoElement.value.muted = !videoElement.value.muted
  }

  const setVolume = (value: number) => {
    if (!videoElement.value) return
    videoElement.value.volume = value
    volume.value = value
    if (value === 0) {
      videoElement.value.muted = true
    } else if (isMuted.value) {
      videoElement.value.muted = false
    }
  }

  // Seek controls
  const seek = (time: number) => {
    if (!videoElement.value) return
    videoElement.value.currentTime = time
    currentTime.value = time
  }

  const seekPercent = (percent: number) => {
    const time = (percent / 100) * duration.value
    seek(time)
  }

  const skip = (seconds: number) => {
    seek(currentTime.value + seconds)
  }

  // Playback rate
  const setPlaybackRate = (rate: number) => {
    if (!videoElement.value) return
    videoElement.value.playbackRate = rate
    playbackRate.value = rate
  }

  return {
    isPlaying,
    isMuted,
    currentTime,
    duration,
    volume,
    playbackRate,
    playbackRates,
    togglePlay,
    play,
    pause,
    toggleMute,
    setVolume,
    seek,
    seekPercent,
    skip,
    setPlaybackRate
  }
}
