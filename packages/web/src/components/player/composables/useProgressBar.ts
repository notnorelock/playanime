/**
 * Progress Bar Composable
 * Handles progress bar interactions (click, hover)
 */

import { ref, type Ref } from 'vue'

export function useProgressBar(
  progressBar: Ref<HTMLDivElement | undefined>,
  duration: Ref<number>,
  seekPercent: (percent: number) => void
) {
  const isHoveringProgress = ref(false)
  const hoverTime = ref(0)

  const onProgressClick = (event: MouseEvent) => {
    if (!progressBar.value) return
    const rect = progressBar.value.getBoundingClientRect()
    const percent = ((event.clientX - rect.left) / rect.width) * 100
    seekPercent(percent)
  }

  const onProgressHover = (event: MouseEvent) => {
    if (!progressBar.value) return
    const rect = progressBar.value.getBoundingClientRect()
    const percent = ((event.clientX - rect.left) / rect.width) * 100
    hoverTime.value = (percent / 100) * duration.value
  }

  return {
    isHoveringProgress,
    hoverTime,
    onProgressClick,
    onProgressHover
  }
}
