<script setup lang="ts">
/**
 * A title's own audit trail — every recorded edit to it or one of its
 * episodes, with real before/after values per field. Visible to staff or
 * the title's owning group, not just staff (see `GET /catalogue/anime/:slug/audit`).
 */

import { onMounted, onUnmounted, ref } from 'vue'
import type { CatalogueAuditEntry } from '@playanime/contracts'
import { AbortError, catalogueApi } from '@/api'
import { useApiError } from '@/composables/useApiError'
import { useLocale } from '@/composables/useLocale'
import { useToast } from '@/composables/useToast'
import { formatRelativeTime } from '@/models/device'
import Card from '@/components/ui/Card.vue'

interface Props {
  slug: string
}

const props = defineProps<Props>()

const { t, locale } = useLocale()
const { translateError } = useApiError()
const toast = useToast()

const entries = ref<CatalogueAuditEntry[]>([])
const loading = ref(true)
let controller: AbortController | null = null

function actionLabel(action: string): string {
  const key = `catalogue.auditActions.${action}`
  const label = t(key)
  return label === key ? action : label
}

function fieldLabel(field: string): string {
  const key = `catalogue.auditFields.${field}`
  const label = t(key)
  return label === key ? field : label
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (Array.isArray(value)) return value.length === 0 ? '—' : value.join(', ')
  if (typeof value === 'boolean') return value ? t('common.confirm') : t('common.cancel')
  return String(value)
}

async function load(): Promise<void> {
  const request = new AbortController()
  controller = request
  loading.value = true

  try {
    const trail = await catalogueApi.auditTrail(props.slug, request.signal)
    entries.value = trail.entries
  } catch (cause: unknown) {
    if (!AbortError.is(cause)) toast.error(translateError(cause))
  } finally {
    loading.value = false
  }
}

onMounted(load)
onUnmounted(() => controller?.abort())
</script>

<template>
  <Card variant="glass">
    <h2 class="text-2xl font-semibold text-text-primary mb-4">{{ t('catalogue.history') }}</h2>

    <div v-if="loading" class="space-y-2">
      <div class="h-20 rounded-lg bg-white/10 animate-pulse" />
      <div class="h-20 rounded-lg bg-white/10 animate-pulse" />
    </div>

    <p v-else-if="entries.length === 0" class="text-text-muted text-sm">
      {{ t('catalogue.historyEmpty') }}
    </p>

    <div v-else class="space-y-3">
      <div v-for="entry in entries" :key="entry.id" class="glass-light rounded-lg p-4">
        <div class="flex items-center justify-between gap-4 mb-2">
          <span class="font-semibold text-text-primary">{{ actionLabel(entry.action) }}</span>
          <span class="text-xs text-text-muted shrink-0">
            {{ formatRelativeTime(entry.createdAt, locale) }}
          </span>
        </div>

        <p class="text-text-secondary text-xs mb-2">
          {{ entry.actorUsername ?? t('catalogue.auditSystemActor') }}
          <span v-if="entry.targetType === 'episode'"> · {{ t('anime.episode') }}</span>
        </p>

        <p v-if="entry.reason" class="text-text-secondary text-sm mb-2">{{ entry.reason }}</p>

        <div v-if="Object.keys(entry.changes).length > 0" class="space-y-1">
          <div
            v-for="(change, field) in entry.changes"
            :key="field"
            class="text-xs text-text-muted grid grid-cols-[auto_1fr_auto_1fr] items-center gap-2"
          >
            <span class="font-medium text-text-secondary">{{ fieldLabel(String(field)) }}</span>
            <span class="truncate line-through opacity-70">{{ formatValue(change.before) }}</span>
            <span>→</span>
            <span class="truncate text-text-primary">{{ formatValue(change.after) }}</span>
          </div>
        </div>
      </div>
    </div>
  </Card>
</template>
