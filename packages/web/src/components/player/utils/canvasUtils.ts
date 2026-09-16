/**
 * Canvas utilities
 * Helper functions for canvas operations
 */

import type { Ref } from 'vue'

export function resizeCanvas(
  canvasElement: Ref<HTMLCanvasElement | undefined>,
  videoContainer: Ref<HTMLDivElement | undefined>
): void {
  if (!canvasElement.value || !videoContainer.value) return

  const canvas = canvasElement.value
  const container = videoContainer.value

  // Set canvas dimensions to match container display size
  const rect = container.getBoundingClientRect()
  canvas.width = rect.width
  canvas.height = rect.height
}
