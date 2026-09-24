import { ref } from 'vue'
import type { ActiveAnnouncementDto } from '@playanime/contracts'
import { AbortError, announcementsApi } from '@/api'

/**
 * Shared state for the site-wide announcement strip.
 *
 * Module-level, same reasoning as `useEmailVerificationBanner`: `App.vue`
 * needs to reserve top padding for the fixed bar using the exact same
 * "is it actually showing" boolean the bar itself renders from, or a
 * dismissal desyncs the two and leaves dead space (or the reverse — content
 * hidden under the bar) once it closes. Fetched once, module-level, rather
 * than once per component instance — every page that mounts this shares one
 * announcement and one loading race, not a fresh request each time the user
 * navigates.
 */
const announcement = ref<ActiveAnnouncementDto>(null)
const dismissed = ref(false)
const loaded = ref(false)

function storageKey(id: string): string {
  return `playanime:dismissed-announcement:${id}`
}

function isDismissedInStorage(id: string): boolean {
  try {
    return localStorage.getItem(storageKey(id)) !== null
  } catch {
    return false
  }
}

let loadPromise: Promise<void> | null = null

async function load(): Promise<void> {
  if (loadPromise !== null) return loadPromise

  loadPromise = (async () => {
    try {
      const active = await announcementsApi.active()
      announcement.value = active
      if (active !== null && isDismissedInStorage(active.id)) dismissed.value = true
    } catch (cause: unknown) {
      if (!AbortError.is(cause)) console.error('Failed to load the announcement:', cause)
    } finally {
      loaded.value = true
    }
  })()

  return loadPromise
}

function dismiss(): void {
  dismissed.value = true
  if (announcement.value === null) return
  try {
    localStorage.setItem(storageKey(announcement.value.id), '1')
  } catch {
    // Best-effort — a private window or blocked storage just means the
    // banner reappears next visit, which is a harmless fallback, not an
    // error worth surfacing.
  }
}

export function useAnnouncementBanner() {
  return { announcement, dismissed, loaded, load, dismiss }
}
