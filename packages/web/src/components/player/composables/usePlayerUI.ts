/**
 * Player UI Composable
 * Handles UI state (controls visibility, fullscreen, settings)
 */

import { ref, type Ref } from 'vue'

export function usePlayerUI(
  videoContainer: Ref<HTMLDivElement | undefined>,
  isPlaying: Ref<boolean>
) {
  const isFullscreen = ref(false)
  const showControls = ref(true)
  const showSettings = ref(false)
  const isHoveringProgress = ref(false)
  const hoverTime = ref(0)

  let controlsTimeout: ReturnType<typeof setTimeout> | null = null

  // Controls visibility
  const showControlsTemporarily = () => {
    showControls.value = true

    if (controlsTimeout) {
      clearTimeout(controlsTimeout)
    }

    if (isPlaying.value) {
      controlsTimeout = setTimeout(() => {
        showControls.value = false
      }, 3000)
    }
  }

  const onMouseMove = () => {
    showControlsTemporarily()
  }

  // Fullscreen
  const toggleFullscreen = () => {
    if (!videoContainer.value) return

    if (!isFullscreen.value) {
      if (videoContainer.value.requestFullscreen) {
        videoContainer.value.requestFullscreen()
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen()
      }
    }
  }

  const onFullscreenChange = () => {
    isFullscreen.value = !!document.fullscreenElement
  }

  const cleanup = () => {
    if (controlsTimeout) {
      clearTimeout(controlsTimeout)
    }
  }

  return {
    isFullscreen,
    showControls,
    showSettings,
    isHoveringProgress,
    hoverTime,
    showControlsTemporarily,
    onMouseMove,
    toggleFullscreen,
    onFullscreenChange,
    cleanup
  }
}
