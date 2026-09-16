<script setup lang="ts">
/**
 * Administration — analytics.
 *
 * Three daily series and a leaderboard, all computed from real rows. Days with
 * no activity come back as zero rather than being omitted, so a quiet week
 * reads as quiet instead of being silently closed up by the chart.
 */

import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import type { AdminAnalyticsDto } from '@playanime/contracts'
import { AbortError, adminApi } from '@/api'
import { useApiError } from '@/composables/useApiError'
import { useLocale } from '@/composables/useLocale'
import { useToast } from '@/composables/useToast'
import Card from '@/components/ui/Card.vue'
import Select from '@/components/ui/Select.vue'
import LineChart from '@/components/ui/Charts/LineChart.vue'
import BarChart from '@/components/ui/Charts/BarChart.vue'

const { t } = useLocale()
const { translateError } = useApiError()
const toast = useToast()

const analytics = ref<AdminAnalyticsDto | null>(null)
const loading = ref(true)
const windowDays = ref(30)

let controller: AbortController | null = null

const rangeOptions = computed(() => [
  { label: t('admin.dashboard.manage.analytics.last7', { count: 7 }), value: 7 },
  { label: t('admin.dashboard.manage.analytics.last30', { count: 30 }), value: 30 },
  { label: t('admin.dashboard.manage.analytics.last90', { count: 90 }), value: 90 }
])

/** Dates are rendered short: a 90-day axis with full dates is unreadable. */
const labels = computed(() =>
  (analytics.value?.registrations ?? []).map((point) =>
    new Date(point.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  )
)

const activityDatasets = computed(() => {
  const data = analytics.value
  if (data === null) return []

  return [
    {
      label: t('admin.dashboard.manage.analytics.registrations'),
      data: data.registrations.map((point) => point.value)
    },
    {
      label: t('admin.dashboard.manage.analytics.comments'),
      data: data.comments.map((point) => point.value)
    },
    {
      label: t('admin.dashboard.manage.analytics.sourceSubmissions'),
      data: data.sourceSubmissions.map((point) => point.value)
    }
  ]
})

const topAnimeLabels = computed(() =>
  (analytics.value?.topAnime ?? []).map((row) =>
    row.title.length > 28 ? `${row.title.slice(0, 27)}…` : row.title
  )
)

const topAnimeDatasets = computed(() => {
  const rows = analytics.value?.topAnime ?? []
  if (rows.length === 0) return []

  return [
    {
      label: t('admin.dashboard.manage.analytics.libraryAdds'),
      data: rows.map((row) => row.libraryCount)
    }
  ]
})

/** Totals over the window, so the charts have a headline figure beside them. */
const totals = computed(() => {
  const data = analytics.value
  if (data === null) return null

  const sum = (points: readonly { value: number }[]): number =>
    points.reduce((accumulator, point) => accumulator + point.value, 0)

  return {
    registrations: sum(data.registrations),
    comments: sum(data.comments),
    sources: sum(data.sourceSubmissions)
  }
})

async function load(): Promise<void> {
  controller?.abort()
  const request = new AbortController()
  controller = request
  loading.value = true

  try {
    analytics.value = await adminApi.analytics({ days: windowDays.value }, request.signal)
  } catch (cause: unknown) {
    if (AbortError.is(cause)) return
    analytics.value = null
    toast.error(translateError(cause))
  } finally {
    if (controller === request) {
      loading.value = false
      controller = null
    }
  }
}

onMounted(load)

watch(windowDays, () => {
  void load()
})

onUnmounted(() => {
  controller?.abort()
})
</script>

<template>
  <div class="admin-analytics space-y-6">
    <div class="flex flex-wrap items-center justify-between gap-4">
      <h2 class="text-2xl font-bold text-text-primary">
        {{ t('admin.dashboard.sections.analytics') }}
      </h2>
      <Select v-model="windowDays" :options="rangeOptions" size="sm" />
    </div>

    <!-- Loading -->
    <div v-if="loading" class="space-y-4">
      <Card v-for="i in 2" :key="i" variant="glass" class="p-6 animate-pulse">
        <div class="h-4 bg-white/10 rounded w-1/4 mb-4"></div>
        <div class="h-64 bg-white/5 rounded"></div>
      </Card>
    </div>

    <template v-else-if="analytics">
      <!-- Totals over the window -->
      <div v-if="totals" class="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card variant="glass" class="p-5">
          <p class="text-sm text-text-secondary mb-1">
            {{ t('admin.dashboard.manage.analytics.registrations') }}
          </p>
          <p class="text-3xl font-bold text-primary">{{ totals.registrations }}</p>
        </Card>
        <Card variant="glass" class="p-5">
          <p class="text-sm text-text-secondary mb-1">
            {{ t('admin.dashboard.manage.analytics.comments') }}
          </p>
          <p class="text-3xl font-bold text-accent-blue">{{ totals.comments }}</p>
        </Card>
        <Card variant="glass" class="p-5">
          <p class="text-sm text-text-secondary mb-1">
            {{ t('admin.dashboard.manage.analytics.sourceSubmissions') }}
          </p>
          <p class="text-3xl font-bold text-accent-cyan">{{ totals.sources }}</p>
        </Card>
      </div>

      <!-- Daily activity -->
      <Card variant="glass" class="p-6">
        <LineChart
          :labels="labels"
          :datasets="activityDatasets"
          :title="t('admin.dashboard.manage.analytics.dailyActivity')"
          :height="320"
        />
        <p class="text-xs text-text-muted mt-3">
          {{ analytics.from }} — {{ analytics.to }}
        </p>
      </Card>

      <!-- Most-added titles -->
      <Card variant="glass" class="p-6">
        <BarChart
          v-if="topAnimeDatasets.length > 0"
          :labels="topAnimeLabels"
          :datasets="topAnimeDatasets"
          :title="t('admin.dashboard.manage.analytics.topAnime')"
          :height="320"
        />
        <p v-else class="text-center text-text-secondary py-12">
          {{ t('admin.dashboard.manage.analytics.noData') }}
        </p>
      </Card>
    </template>

    <Card v-else variant="glass" class="p-8 text-center text-text-secondary">
      {{ t('admin.dashboard.manage.analytics.noData') }}
    </Card>
  </div>
</template>
