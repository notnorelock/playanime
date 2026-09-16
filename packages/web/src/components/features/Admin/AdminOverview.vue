<script setup lang="ts">
/**
 * Administration — overview.
 *
 * Every tile is an exact count from a table. The previous version mapped a
 * handful of fields and left the rest at zero; where the API has no figure the
 * tile is simply absent, because a dashboard that displays invented numbers is
 * worse than one that displays fewer.
 */

import { computed, onMounted, onUnmounted, ref } from 'vue'
import {
  AlertCircle,
  Film,
  Globe,
  MessageSquare,
  Star,
  TrendingUp,
  Users,
  Video
} from 'lucide-vue-next'
import type { AdminOverviewDto } from '@playanime/contracts'
import { AbortError, adminApi } from '@/api'
import { useApiError } from '@/composables/useApiError'
import { useLocale } from '@/composables/useLocale'
import { useToast } from '@/composables/useToast'

const { t } = useLocale()
const { translateError } = useApiError()
const toast = useToast()

const overview = ref<AdminOverviewDto | null>(null)
const loading = ref(true)

let controller: AbortController | null = null

interface Tile {
  readonly key: string
  readonly label: string
  readonly value: number
  readonly icon: unknown
  readonly tone: string
  /** Rendered under the value when there is useful context. */
  readonly hint?: string
}

const tiles = computed<Tile[]>(() => {
  const data = overview.value
  if (data === null) return []

  return [
    {
      key: 'users',
      label: t('admin.dashboard.overview.totalUsers'),
      value: data.users.total,
      icon: Users,
      tone: 'text-accent-blue',
      hint: t('admin.dashboard.overview.newLast7', { count: data.users.newLast7Days })
    },
    {
      key: 'anime',
      label: t('admin.dashboard.overview.totalAnime'),
      value: data.catalogue.anime,
      icon: Film,
      tone: 'text-accent-purple'
    },
    {
      key: 'episodes',
      label: t('admin.dashboard.overview.totalEpisodes'),
      value: data.catalogue.episodes,
      icon: Video,
      tone: 'text-accent-cyan'
    },
    {
      key: 'sources',
      label: t('admin.dashboard.overview.totalSources'),
      value: data.catalogue.sources,
      icon: TrendingUp,
      tone: 'text-accent-cyan'
    },
    {
      key: 'comments',
      label: t('admin.dashboard.overview.totalComments'),
      value: data.engagement.comments,
      icon: MessageSquare,
      tone: 'text-accent-blue'
    },
    {
      key: 'ratings',
      label: t('admin.dashboard.overview.totalRatings'),
      value: data.engagement.ratings,
      icon: Star,
      tone: 'text-primary'
    },
    {
      key: 'translators',
      label: t('admin.dashboard.overview.totalTranslators'),
      value: data.translators.groups,
      icon: Globe,
      tone: 'text-accent-purple'
    },
    {
      key: 'suspended',
      label: t('admin.dashboard.overview.suspendedUsers'),
      value: data.users.suspended,
      icon: AlertCircle,
      tone: data.users.suspended > 0 ? 'text-red-400' : 'text-text-muted'
    }
  ]
})

/** Items needing a moderator's attention, surfaced separately from the counts. */
const queues = computed(() => {
  const data = overview.value
  if (data === null) return []

  return [
    {
      key: 'pendingSources',
      label: t('admin.dashboard.overview.pendingSources'),
      value: data.moderation.pendingSources
    },
    {
      key: 'openReports',
      label: t('admin.dashboard.overview.openReports'),
      value: data.moderation.openReports
    },
    {
      key: 'pendingApplications',
      label: t('admin.dashboard.overview.pendingApplications'),
      value: data.translators.pendingApplications
    }
  ]
})

async function load(): Promise<void> {
  const request = new AbortController()
  controller = request
  loading.value = true

  try {
    overview.value = await adminApi.overview(request.signal)
  } catch (cause: unknown) {
    if (AbortError.is(cause)) return
    toast.error(translateError(cause))
  } finally {
    if (controller === request) {
      loading.value = false
      controller = null
    }
  }
}

onMounted(load)

onUnmounted(() => {
  controller?.abort()
})
</script>

<template>
  <div class="admin-overview space-y-6">
    <h2 class="text-2xl font-bold text-text-primary">
      {{ t('admin.dashboard.overview.title') }}
    </h2>

    <!-- Loading State -->
    <div v-if="loading" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      <div v-for="i in 8" :key="i" class="glass-medium rounded-lg p-6 animate-pulse">
        <div class="h-4 bg-white/10 rounded w-20 mb-3"></div>
        <div class="h-8 bg-white/10 rounded w-16"></div>
      </div>
    </div>

    <template v-else-if="overview">
      <!-- Counts -->
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div
          v-for="tile in tiles"
          :key="tile.key"
          class="glass-medium rounded-lg p-6 hover:glass-strong transition-smooth"
        >
          <div class="flex items-start justify-between mb-3">
            <p class="text-sm text-text-secondary">{{ tile.label }}</p>
            <component :is="tile.icon" :size="20" :class="tile.tone" />
          </div>
          <p class="text-3xl font-bold text-text-primary">{{ tile.value.toLocaleString() }}</p>
          <p v-if="tile.hint" class="text-xs text-text-muted mt-1">{{ tile.hint }}</p>
        </div>
      </div>

      <!-- Moderation queues -->
      <div>
        <h3 class="text-lg font-semibold text-text-primary mb-3">
          {{ t('admin.dashboard.overview.needsAttention') }}
        </h3>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div
            v-for="queue in queues"
            :key="queue.key"
            class="glass-medium rounded-lg p-4 flex items-center justify-between"
          >
            <span class="text-text-secondary text-sm">{{ queue.label }}</span>
            <span
              class="text-2xl font-bold"
              :class="queue.value > 0 ? 'text-primary' : 'text-text-muted'"
            >
              {{ queue.value }}
            </span>
          </div>
        </div>
      </div>

      <p class="text-xs text-text-muted">
        {{ t('admin.dashboard.overview.generatedAt') }}:
        {{ new Date(overview.generatedAt).toLocaleString() }}
      </p>
    </template>
  </div>
</template>
