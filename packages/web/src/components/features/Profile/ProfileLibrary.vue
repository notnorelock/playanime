<script setup lang="ts">
/**
 * ProfileLibrary
 *
 * The signed-in viewer's own list, filtered by watch status. The API paginates
 * by cursor and filters server-side, so switching a tab is one request for one
 * page rather than a client-side filter over everything.
 */

import { onMounted, onUnmounted, ref } from 'vue'
import { WATCH_STATUSES, type WatchStatus } from '@playanime/contracts'
import { AbortError, libraryApi } from '@/api'
import { toAnimeCardModel, type AnimeCardModel } from '@/models'
import { useLocale } from '@/composables/useLocale'
import AnimeGrid from '@/components/shared/AnimeGrid.vue'
import LoadMore from '@/components/shared/LoadMore.vue'

const { t } = useLocale()

const activeStatus = ref<WatchStatus>('watching')
const items = ref<AnimeCardModel[]>([])
const loading = ref(false)
const loadingMore = ref(false)
const hasMore = ref(false)
const error = ref<string | null>(null)

let cursor: string | null = null
let controller: AbortController | null = null

async function load(status: WatchStatus, append = false): Promise<void> {
  controller?.abort()
  const request = new AbortController()
  controller = request

  if (append) loadingMore.value = true
  else loading.value = true
  error.value = null

  try {
    const page = await libraryApi.list(
      { status, limit: 24, ...(append && cursor !== null ? { cursor } : {}) },
      request.signal
    )

    if (request.signal.aborted) return

    const cards = page.items.map((entry) => toAnimeCardModel(entry.anime))
    items.value = append ? [...items.value, ...cards] : cards
    cursor = page.nextCursor
    hasMore.value = page.hasMore
  } catch (cause: unknown) {
    if (AbortError.is(cause)) return
    if (!append) items.value = []
    error.value = t('profile.errors.loadFailed')
  } finally {
    if (controller === request) {
      loading.value = false
      loadingMore.value = false
      controller = null
    }
  }
}

function selectStatus(status: WatchStatus): void {
  if (status === activeStatus.value) return
  activeStatus.value = status
  cursor = null
  void load(status)
}

onMounted(() => {
  void load(activeStatus.value)
})

onUnmounted(() => {
  controller?.abort()
})
</script>

<template>
  <div class="profile-library space-y-6">
    <div class="glass-medium rounded-lg p-1 inline-flex gap-1 flex-wrap">
      <button
        v-for="status in WATCH_STATUSES"
        :key="status"
        type="button"
        class="px-4 py-2 rounded-md text-sm font-medium transition-smooth"
        :class="[
          activeStatus === status
            ? 'bg-primary text-white'
            : 'text-text-secondary hover:text-text-primary hover:bg-white/10'
        ]"
        @click="selectStatus(status)"
      >
        {{ t(`library.status.${status}`) }}
      </button>
    </div>

    <div v-if="error" class="glass-medium rounded-lg p-6 text-center text-red-300">
      {{ error }}
    </div>

    <template v-else>
      <AnimeGrid
        :anime-list="items"
        :loading="loading"
        :columns="{ default: 2, md: 3, lg: 4, xl: 5 }"
      />

      <p v-if="!loading && items.length === 0" class="text-center text-text-secondary py-8">
        {{ t('library.empty') }}
      </p>

      <LoadMore
        :has-more="hasMore"
        :loading="loadingMore"
        @load-more="load(activeStatus, true)"
      />
    </template>
  </div>
</template>
