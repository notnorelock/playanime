/**
 * Video Events Composable
 * Handles all video element event listeners and state updates
 */

import { ref, type Ref } from 'vue'

export function useVideoEvents(
  videoElement: Ref<HTMLVideoElement | undefined>,
  onMetadataLoaded: (duration: number) => void,
  onTimeChange: (time: number) => void,
  onVideoEnded: () => void,
  onVideoPlayed?: () => void
) {
  const bufferedPercent = ref(0)

  const onLoadedMetadata = () => {
    if (videoElement.value) {
      onMetadataLoaded(videoElement.value.duration)
    }
  }

  const onTimeUpdate = () => {
    if (videoElement.value) {
      onTimeChange(videoElement.value.currentTime)
    }
  }

  const onEnded = () => {
    onVideoEnded()
  }

  const onVolumeChange = (volumeRef: Ref<number>, isMutedRef: Ref<boolean>) => {
    if (videoElement.value) {
      volumeRef.value = videoElement.value.volume
      isMutedRef.value = videoElement.value.muted
    }
  }

  const onProgress = (durationRef: Ref<number>) => {
    if (videoElement.value && videoElement.value.buffered.length > 0) {
      const buffered = videoElement.value.buffered.end(videoElement.value.buffered.length - 1)
      bufferedPercent.value = (buffered / durationRef.value) * 100
    }
  }

  const setupVideoListeners = (
    isPlayingRef: Ref<boolean>,
    volumeRef: Ref<number>,
    isMutedRef: Ref<boolean>,
    durationRef: Ref<number>,
    isLoadingRef: Ref<boolean>
  ) => {
    if (!videoElement.value) return

    const video = videoElement.value

    video.addEventListener('loadedmetadata', onLoadedMetadata)
    video.addEventListener('timeupdate', onTimeUpdate)
    video.addEventListener('ended', onEnded)
    video.addEventListener('play', () => {
      isPlayingRef.value = true
      if (onVideoPlayed) onVideoPlayed()
    })
    video.addEventListener('pause', () => { isPlayingRef.value = false })
    video.addEventListener('volumechange', () => onVolumeChange(volumeRef, isMutedRef))
    video.addEventListener('progress', () => onProgress(durationRef))
    video.addEventListener('waiting', () => { isLoadingRef.value = true })
    video.addEventListener('canplay', () => { isLoadingRef.value = false })
  }

  return {
    bufferedPercent,
    setupVideoListeners
  }
}
