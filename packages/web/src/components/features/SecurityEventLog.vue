<script setup lang="ts">
/**
 * Security event log, shown on the security settings screen.
 *
 * Cursor-paginated ("load more"), matching `SecurityEventPage`'s cursor
 * envelope — this log is genuinely unbounded and growing, unlike the device
 * list, which is a plain array.
 */

import { onMounted, ref } from 'vue'
import type { SecurityEventSummary } from '@playanime/contracts'
import { devicesApi } from '@/api'
import { formatRelativeTime } from '@/models/device'
import { useApiError } from '@/composables/useApiError'
import { useLocale } from '@/composables/useLocale'
import { useToast } from '@/composables/useToast'
import Card from '@/components/ui/Card.vue'
import Button from '@/components/ui/Button.vue'

const { t, locale } = useLocale()
const { translateError } = useApiError()
const toast = useToast()

const events = ref<SecurityEventSummary[]>([])
const loading = ref(true)
const loadingMore = ref(false)
const cursor = ref<string | null>(null)
const hasMore = ref(false)

function eventLabel(eventType: string): string {
  const key = `security.events.types.${eventType}`
  const label = t(key)
  return label === key ? eventType : label
}

async function load(): Promise<void> {
  loading.value = true
  try {
    const page = await devicesApi.securityEvents()
    events.value = page.items
    cursor.value = page.nextCursor
    hasMore.value = page.hasMore
  } catch (cause: unknown) {
    toast.error(translateError(cause))
  } finally {
    loading.value = false
  }
}

onMounted(load)

async function loadMore(): Promise<void> {
  if (cursor.value === null) return

  loadingMore.value = true
  try {
    const page = await devicesApi.securityEvents(cursor.value)
    events.value = [...events.value, ...page.items]
    cursor.value = page.nextCursor
    hasMore.value = page.hasMore
  } catch (cause: unknown) {
    toast.error(translateError(cause))
  } finally {
    loadingMore.value = false
  }
}
</script>

<template>
  <Card variant="glass" class="mb-6">
    <h2 class="text-2xl font-semibold text-text-primary mb-4">{{ t('security.events.title') }}</h2>

    <div v-if="loading" class="space-y-2">
      <div class="h-10 rounded-lg bg-white/10 animate-pulse" />
      <div class="h-10 rounded-lg bg-white/10 animate-pulse" />
    </div>

    <p v-else-if="events.length === 0" class="text-text-muted text-sm">
      {{ t('security.events.empty') }}
    </p>

    <div v-else class="space-y-1">
      <div
        v-for="event in events"
        :key="event.id"
        class="flex items-center justify-between gap-4 py-2 border-b border-white/5 last:border-0"
      >
        <p class="text-text-primary text-sm">{{ eventLabel(event.eventType) }}</p>
        <p class="text-xs text-text-muted shrink-0">{{ formatRelativeTime(event.createdAt, locale) }}</p>
      </div>

      <div v-if="hasMore" class="pt-3 text-center">
        <Button variant="ghost" size="sm" :disabled="loadingMore" @click="loadMore">
          {{ t('security.events.loadMore') }}
        </Button>
      </div>
    </div>
  </Card>
</template>
