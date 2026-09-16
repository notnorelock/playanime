/**
 * Keyboard Shortcuts Composable
 * Handles keyboard controls for the video player
 */

import { type Ref } from 'vue'

export function useKeyboardShortcuts(
  togglePlay: () => void,
  toggleFullscreen: () => void,
  toggleMute: () => void,
  skip: (seconds: number) => void,
  setVolume: (volume: number) => void,
  volume: Ref<number>
) {
  const onKeyPress = (event: KeyboardEvent) => {
    // Don't handle shortcuts if user is typing in an input/textarea
    const target = event.target as HTMLElement
    if (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.isContentEditable
    ) {
      return
    }

    switch (event.code) {
      case 'Space':
        event.preventDefault()
        togglePlay()
        break
      case 'KeyF':
        event.preventDefault()
        toggleFullscreen()
        break
      case 'KeyM':
        event.preventDefault()
        toggleMute()
        break
      case 'ArrowLeft':
        event.preventDefault()
        skip(-10)
        break
      case 'ArrowRight':
        event.preventDefault()
        skip(10)
        break
      case 'ArrowUp':
        event.preventDefault()
        setVolume(Math.min(volume.value + 0.1, 1))
        break
      case 'ArrowDown':
        event.preventDefault()
        setVolume(Math.max(volume.value - 0.1, 0))
        break
    }
  }

  return {
    onKeyPress
  }
}
