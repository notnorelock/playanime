/**
 * Skip Intro Composable
 * Handles skip intro button visibility and functionality
 */

import { computed } from 'vue'

interface SkipIntroOptions {
  introStart?: number
  introEnd?: number
}

export function useSkipIntro(
  currentTime: { value: number },
  options: SkipIntroOptions
) {
  const { introStart, introEnd } = options

  // Show skip intro button when within intro range
  const showSkipIntro = computed(() => {
    if (introStart === undefined || introEnd === undefined) return false
    if (introStart < 0 || introEnd <= introStart) return false
    
    const time = currentTime.value
    return time >= introStart && time < introEnd
  })

  // Calculate remaining intro time
  const remainingIntroTime = computed(() => {
    if (!introEnd) return 0
    return Math.max(0, introEnd - currentTime.value)
  })

  return {
    showSkipIntro,
    remainingIntroTime,
    introStart,
    introEnd
  }
}
