import { computed, ref } from 'vue'
import type { CataloguePermissions } from '@playanime/contracts'
import { AbortError, catalogueApi } from '@/api'
import { useAuthStore } from '@/store/auth'

/**
 * What the current user may author.
 *
 * Module-level state rather than per-component: several views ask the same
 * question on the same page — a title page showing an edit button, an episode
 * list showing an add-source control — and each mounting its own request would
 * mean three identical round trips.
 *
 * This decides what to *render*. The server decides what is *allowed*, and a
 * view that gets this wrong produces a 403, not an unauthorized write.
 */

const ANONYMOUS: CataloguePermissions = {
  canCreateAnime: false,
  canEditAnyAnime: false,
  canCreateEpisodes: false,
  canSubmitSources: false,
  sourcesPublishImmediately: false,
  canModerate: false,
  groups: []
}

const permissions = ref<CataloguePermissions>(ANONYMOUS)
const loading = ref(false)

/** Shared so concurrent callers await one request rather than each issuing one. */
let pending: Promise<void> | null = null
/** The user the cached answer belongs to, so it is not reused across sessions. */
let resolvedForUserId: string | null = null

export function useCataloguePermissions() {
  const authStore = useAuthStore()

  async function load(force = false): Promise<void> {
    const userId = authStore.user?.id ?? null

    if (userId === null) {
      // Signing out must not leave the previous user's permissions behind.
      permissions.value = ANONYMOUS
      resolvedForUserId = null
      return
    }

    if (!force && resolvedForUserId === userId) return
    if (pending !== null) return pending

    loading.value = true

    pending = (async () => {
      try {
        permissions.value = await catalogueApi.permissions()
        resolvedForUserId = userId
      } catch (cause: unknown) {
        if (!AbortError.is(cause)) permissions.value = ANONYMOUS
      } finally {
        loading.value = false
        pending = null
      }
    })()

    return pending
  }

  /** Groups the user may author on behalf of. Empty for staff acting alone. */
  const groups = computed(() => permissions.value.groups)

  /** Whether the user can author at all, in any capacity. */
  const canAuthor = computed(
    () => permissions.value.canCreateAnime || permissions.value.canCreateEpisodes
  )

  return {
    permissions,
    loading,
    groups,
    canAuthor,
    load
  }
}
