<script setup lang="ts">
/**
 * ProfileActivity
 *
 * The public activity feed the API exposes for a profile: library changes,
 * ratings and comments the user has made public. It replaces the old watch
 * history panel — playback progress is private to the viewer who recorded it
 * and the new API does not publish it on someone else's profile.
 */

import { onMounted, onUnmounted, ref, watch } from 'vue'
import type { ActivityItem } from '@playanime/contracts'
import { AbortError, profilesApi } from '@/api'
import { useLocale } from '@/composables/useLocale'
import Button from '@/components/ui/Button.vue'

interface Props {
  username: string
}

const props = defineProps<Props>()

const { t, locale } = useLocale()

const items = ref<ActivityItem[]>([])
const loading = ref(false)
const hasMore = ref(false)
const error = ref<string | null>(null)

let cursor: string | null = null
let controller: AbortController | null = null

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value)
  )
}

async function load(append = false): Promise<void> {
  controller?.abort()
  const request = new AbortController()
  controller = request

  loading.value = true
  error.value = null

  try {
    const page = await profilesApi.activity(
      props.username,
      { limit: 20, ...(append && cursor !== null ? { cursor } : {}) },
      request.signal
    )

    if (request.signal.aborted) return

    items.value = append ? [...items.value, ...page.items] : page.items
    cursor = page.nextCursor
    hasMore.value = page.hasMore
  } catch (cause: unknown) {
    if (AbortError.is(cause)) return
    error.value = t('profile.errors.loadFailed')
  } finally {
    if (controller === request) {
      loading.value = false
      controller = null
    }
  }
}

onMounted(() => {
  void load()
})

watch(
  () => props.username,
  () => {
    cursor = null
    void load()
  }
)

onUnmounted(() => {
  controller?.abort()
})
</script>

<template>
  <div class="profile-activity space-y-3">
    <!-- Loading skeleton -->
    <template v-if="loading && items.length === 0">
      <div v-for="i in 5" :key="i" class="glass-medium rounded-lg p-4 animate-pulse">
        <div class="h-4 bg-white/10 rounded w-2/3 mb-2"></div>
        <div class="h-3 bg-white/10 rounded w-24"></div>
      </div>
    </template>

    <div v-else-if="error" class="glass-medium rounded-lg p-6 text-center text-red-300">
      {{ error }}
    </div>

    <div
      v-else-if="items.length === 0"
      class="glass-medium rounded-lg p-6 text-center text-text-secondary"
    >
      {{ t('profile.activity.empty') }}
    </div>

    <template v-else>
      <div v-for="item in items" :key="item.id" class="glass-medium rounded-lg p-4">
        <p class="text-text-primary">{{ item.summary }}</p>
        <p class="text-xs text-text-muted mt-1">{{ formatDate(item.occurredAt) }}</p>
      </div>

      <div v-if="hasMore" class="text-center pt-2">
        <Button variant="glass" :disabled="loading" @click="load(true)">
          {{ loading ? t('common.loading') : t('common.loadMore') }}
        </Button>
      </div>
    </template>
  </div>
</template>
