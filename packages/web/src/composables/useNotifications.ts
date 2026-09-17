import { computed, ref } from 'vue'
import type { Notification } from '@playanime/contracts'
import { AbortError, notificationsApi } from '@/api'
import { useAuthStore } from '@/store/auth'

/**
 * The signed-in user's notifications.
 *
 * Module-level state, mirroring `useCataloguePermissions`: the bell in the
 * sidebar, its mobile equivalent, and the full `/notifications` page all
 * ask the same question, and each mounting its own poll would mean
 * duplicate requests and an unread count that disagrees between them.
 *
 * There is no realtime push for notifications yet — `unreadCount` only
 * ever changes on an explicit `load()`/`refreshUnreadCount()` call or the
 * periodic poll started by `startPolling()`. A notification that arrives
 * between polls is invisible until the next one, which is an accepted,
 * explicitly scoped-down v1 (see the plan this shipped under).
 */

const recent = ref<Notification[]>([])
const unreadCount = ref(0)
const loading = ref(false)
const cursor = ref<string | null>(null)
const hasMore = ref(false)

/** The user the cached state belongs to, so it is not reused across sessions. */
let loadedForUserId: string | null = null
let pending: Promise<void> | null = null
let pollTimer: ReturnType<typeof setInterval> | null = null
let pollersActive = 0

const RECENT_PAGE_SIZE = 8
const POLL_INTERVAL_MS = 45_000

export function useNotifications() {
  const authStore = useAuthStore()

  function reset(): void {
    recent.value = []
    unreadCount.value = 0
    cursor.value = null
    hasMore.value = false
    loadedForUserId = null
  }

  /** Loads the first page of recent notifications, for the dropdown. */
  async function load(force = false): Promise<void> {
    const userId = authStore.user?.id ?? null

    if (userId === null) {
      reset()
      return
    }

    if (!force && loadedForUserId === userId) return
    if (pending !== null) return pending

    loading.value = true

    pending = (async () => {
      try {
        const page = await notificationsApi.list({ limit: RECENT_PAGE_SIZE })
        recent.value = page.items
        unreadCount.value = page.unreadCount
        cursor.value = page.nextCursor
        hasMore.value = page.hasMore
        loadedForUserId = userId
      } catch (cause: unknown) {
        if (!AbortError.is(cause)) reset()
      } finally {
        loading.value = false
        pending = null
      }
    })()

    return pending
  }

  /**
   * A lighter refresh than `load()`: just the count, for the poll tick — the
   * dropdown's own list only needs to be current while it is actually open.
   */
  async function refreshUnreadCount(): Promise<void> {
    if (authStore.user === null) {
      reset()
      return
    }

    try {
      const page = await notificationsApi.list({ limit: 1 })
      unreadCount.value = page.unreadCount
    } catch (cause: unknown) {
      if (!AbortError.is(cause)) { /* a failed background poll should not clear what is already shown */ }
    }
  }

  /** Loads more of the full history, for the standalone `/notifications` page. */
  async function loadMore(): Promise<void> {
    if (cursor.value === null) return

    loading.value = true
    try {
      const page = await notificationsApi.list({ limit: RECENT_PAGE_SIZE, cursor: cursor.value })
      recent.value = [...recent.value, ...page.items]
      unreadCount.value = page.unreadCount
      cursor.value = page.nextCursor
      hasMore.value = page.hasMore
    } finally {
      loading.value = false
    }
  }

  async function markAllRead(): Promise<void> {
    const previousUnread = unreadCount.value
    unreadCount.value = 0
    recent.value = recent.value.map((item) => ({ ...item, readAt: item.readAt ?? new Date().toISOString() }))

    try {
      await notificationsApi.markRead()
    } catch (cause: unknown) {
      if (!AbortError.is(cause)) unreadCount.value = previousUnread
    }
  }

  async function markOneRead(notification: Notification): Promise<void> {
    if (notification.readAt !== null) return

    const index = recent.value.findIndex((item) => item.id === notification.id)
    if (index >= 0) {
      const updated = [...recent.value]
      updated[index] = { ...notification, readAt: new Date().toISOString() }
      recent.value = updated
    }
    unreadCount.value = Math.max(0, unreadCount.value - 1)

    try {
      await notificationsApi.markOneRead(notification.id)
    } catch (cause: unknown) {
      if (!AbortError.is(cause)) void load(true)
    }
  }

  /**
   * Reference-counted so several mounted consumers (bell + mobile bell, say)
   * share one interval instead of each starting/stopping their own.
   */
  function startPolling(): void {
    pollersActive += 1
    if (pollTimer !== null) return

    pollTimer = setInterval(() => void refreshUnreadCount(), POLL_INTERVAL_MS)
  }

  function stopPolling(): void {
    pollersActive = Math.max(0, pollersActive - 1)
    if (pollersActive > 0) return

    if (pollTimer !== null) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }

  const hasUnread = computed(() => unreadCount.value > 0)

  return {
    recent,
    unreadCount,
    hasUnread,
    loading,
    hasMore,
    load,
    loadMore,
    refreshUnreadCount,
    markAllRead,
    markOneRead,
    startPolling,
    stopPolling,
  }
}
