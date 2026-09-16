import { watch, onMounted } from 'vue'

const prefix = 'playanime -'

/**
 * Composable to set page title dynamically
 */
export function usePageTitle(titleGetter: () => string) {
  const updateTitle = () => {
    try {
      const title = titleGetter()
      if (title) document.title = `${prefix} ${title}`
    } catch (error) {
      // Ignore errors
    }
  }

  // Update on mount
  onMounted(() => {
    updateTitle()
  })

  // Watch for changes (when data loads from API)
  watch(() => titleGetter(), (newTitle) => {
    if (newTitle) document.title = `${prefix} ${newTitle}`
  })

  return {
    updateTitle
  }
}
