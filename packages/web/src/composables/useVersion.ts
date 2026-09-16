/**
 * Version Info Composable
 * Provides client version information from git
 */

import { ref, onMounted } from 'vue'

export interface VersionInfo {
  version: string
  commitHash: string
  commitCount: number
  branch: string
  buildTime: string
}

const versionInfo = ref<VersionInfo | null>(null)
const isLoaded = ref(false)

// Load version immediately (not waiting for component mount)
const loadVersion = async () => {
  if (isLoaded.value) return

  try {
    const response = await fetch('/version.json')
    if (response.ok) {
      versionInfo.value = await response.json()
      isLoaded.value = true
    }
  } catch (error) {
    console.error('Failed to load version info:', error)
    // Fallback version
    versionInfo.value = {
      version: 'dev',
      commitHash: 'unknown',
      commitCount: 0,
      branch: 'unknown',
      buildTime: new Date().toISOString()
    }
    isLoaded.value = true
  }
}

// Load immediately when module is imported
loadVersion()

export function useVersion() {
  onMounted(() => {
    // Ensure it's loaded on mount (in case it failed earlier)
    if (!isLoaded.value) {
      loadVersion()
    }
  })

  return {
    versionInfo,
    isLoaded,
    loadVersion
  }
}

// Export the singleton refs for direct access (non-reactive contexts like API client)
export { versionInfo as versionInfoSingleton }
