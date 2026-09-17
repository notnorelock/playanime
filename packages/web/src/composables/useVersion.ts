/**
 * Version Info Composable
 * Provides client version information from git
 */

import { ref, onMounted } from 'vue'

async function fetchNow(): Promise<VersionInfo | null> {
  const response = await fetch(`/version.json?_=${Date.now()}`, { cache: 'no-store' })
  if (response.ok) {
    return await response.json()
  }
  return null
}

export interface VersionInfo {
  version: string
  commitHash: string
  commitCount: number
  branch: string
  buildTime: string
}

const versionInfo = ref<VersionInfo | null>(null)
const isLoaded = ref(false)
/** The commitHash this tab was loaded with — fixed once known, never updated by a poll. */
const loadedCommitHash = ref<string | null>(null)
/** True once a poll sees version.json's commitHash differ from loadedCommitHash. */
const updateAvailable = ref(false)

// Load version immediately (not waiting for component mount)
const loadVersion = async () => {
  if (isLoaded.value) return

  try {
    const response = await fetchNow()
    if (response) {
      versionInfo.value = response
      isLoaded.value = true
      loadedCommitHash.value = versionInfo.value?.commitHash ?? null
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

/**
 * Re-fetches version.json and flips updateAvailable if its commitHash no
 * longer matches the one this tab loaded with. Opportunistic — a failed
 * fetch (offline, a proxy hiccup) is silently ignored rather than shown to
 * the user, since this is a "nice to know", not a critical path.
 */
async function checkForUpdate(): Promise<void> {
  if (updateAvailable.value || loadedCommitHash.value === null) return

  try {
    const response = await fetchNow()
    if (response && response.commitHash && response.commitHash !== loadedCommitHash.value) {
      updateAvailable.value = true
    }
  } catch {
    // Opportunistic — normal browsing must never be affected.
  }
}

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
    loadVersion,
    updateAvailable,
    checkForUpdate
  }
}

// Export the singleton refs for direct access (non-reactive contexts like API client)
export { versionInfo as versionInfoSingleton }
