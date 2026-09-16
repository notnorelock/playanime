/**
 * Image Loader Composable
 * Provides lazy loading with skeleton state for images
 */

import { ref, onMounted, onUnmounted } from 'vue'

export function useImageLoader(src: string) {
  const imageLoaded = ref(false)
  const imageError = ref(false)
  const imageRef = ref<HTMLImageElement | null>(null)

  let observer: IntersectionObserver | null = null

  const loadImage = () => {
    if (!imageRef.value) return

    const img = new Image()
    img.src = src

    img.onload = () => {
      imageLoaded.value = true
      imageError.value = false
    }

    img.onerror = () => {
      imageError.value = true
      imageLoaded.value = false
    }
  }

  onMounted(() => {
    if (!imageRef.value) return

    // Use IntersectionObserver for lazy loading
    observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            loadImage()
            observer?.disconnect()
          }
        })
      },
      {
        rootMargin: '50px' // Start loading 50px before image enters viewport
      }
    )

    observer.observe(imageRef.value)
  })

  onUnmounted(() => {
    observer?.disconnect()
  })

  return {
    imageRef,
    imageLoaded,
    imageError
  }
}
