<script setup lang="ts">
/**
 * Homepage announcement strip. Renders nothing when there is no active
 * announcement — this is not a skeleton-loading component, since a missing
 * announcement is a normal, common state, not a loading state worth
 * showing a placeholder for.
 */

import { onMounted, onUnmounted, ref } from 'vue'
import { Megaphone, X } from 'lucide-vue-next'
import type { ActiveAnnouncementDto } from '@playanime/contracts'
import { AbortError, announcementsApi } from '@/api'
import { useLocale } from '@/composables/useLocale'

const { t } = useLocale()

const announcement = ref<ActiveAnnouncementDto>(null)
const dismissed = ref(false)

let controller: AbortController | null = null

/** Per-viewer, not per-account: dismissing on this device doesn't hide it on another, and a NEW announcement (different id) is never suppressed by an old dismissal. */
function storageKey(id: string): string {
  return `playanime:dismissed-announcement:${id}`
}

function isDismissed(id: string): boolean {
  try {
    return localStorage.getItem(storageKey(id)) !== null
  } catch {
    return false
  }
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

onMounted(async () => {
  const request = new AbortController()
  controller = request

  try {
    const active = await announcementsApi.active(request.signal)
    if (request.signal.aborted) return
    announcement.value = active
    if (active !== null && isDismissed(active.id)) dismissed.value = true
  } catch (cause: unknown) {
    if (!AbortError.is(cause)) console.error('Failed to load the announcement:', cause)
  }
})

onUnmounted(() => {
  controller?.abort()
})
</script>

<template>
  <div v-if="announcement && !dismissed" class="announcement-banner bg-primary text-white">
    <div class="container mx-auto px-4 py-2.5 flex items-center gap-3">
      <Megaphone :size="18" class="shrink-0" />
      <p class="flex-1 text-sm font-medium">
        {{ announcement.message }}
        <a
          v-if="announcement.linkUrl"
          :href="announcement.linkUrl"
          class="underline decoration-white/60 hover:decoration-white ml-1"
        >
          {{ announcement.linkLabel ?? t('common.viewAll') }}
        </a>
      </p>
      <button
        type="button"
        class="shrink-0 opacity-80 hover:opacity-100 transition-smooth"
        :aria-label="t('common.dismiss')"
        @click="dismiss"
      >
        <X :size="18" />
      </button>
    </div>
  </div>
</template>
