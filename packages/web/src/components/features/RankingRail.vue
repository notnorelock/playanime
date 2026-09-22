<script setup lang="ts">
/**
 * Home-page ranking rail — week/month/year/all-time tabs.
 *
 * Ranked by distinct viewers in the period (see `RankingPeriod`'s own doc
 * comment in @playanime/contracts for why — there is no other real,
 * time-windowed popularity signal in this app; `series.popularityScore` is
 * a static column only ever set by dev seed data). Each period is fetched
 * independently and cached client-side per tab for the life of the page,
 * so switching back to an already-viewed period doesn't re-request it.
 *
 * A custom card loop rather than `AnimeGrid` — `AnimeGrid` has no per-item
 * slot, and a ranking's whole point is the visible #1, #2, #3 position,
 * which needs a badge on top of each card.
 */

import { computed, onMounted, onUnmounted, ref } from 'vue'
import { Trophy } from 'lucide-vue-next'
import { RANKING_PERIODS, type RankingPeriod, type RankingEntryDto } from '@playanime/contracts'
import { AbortError, discoveryApi } from '@/api'
import { toAnimeCardModel } from '@/models'
import { useLocale } from '@/composables/useLocale'
import AnimeCard from '@/components/shared/AnimeCard.vue'
import SkeletonCard from '@/components/ui/SkeletonCard.vue'

const RAIL_LIMIT = 10

const { t } = useLocale()

const activePeriod = ref<RankingPeriod>('week')
const loading = ref(true)
const error = ref(false)

/** One cache per period, so a tab switch after the first load is instant and does not re-fetch. */
const cache = new Map<RankingPeriod, RankingEntryDto[]>()
const entries = ref<RankingEntryDto[]>([])

let controller: AbortController | null = null

async function load(period: RankingPeriod): Promise<void> {
  const cached = cache.get(period)
  if (cached !== undefined) {
    entries.value = cached
    loading.value = false
    error.value = false
    return
  }

  controller?.abort()
  const request = new AbortController()
  controller = request
  loading.value = true
  error.value = false

  try {
    const response = await discoveryApi.ranking(period, RAIL_LIMIT, request.signal)
    cache.set(period, response.entries)
    entries.value = response.entries
  } catch (cause: unknown) {
    if (AbortError.is(cause)) return
    error.value = true
    entries.value = []
  } finally {
    if (controller === request) {
      loading.value = false
      controller = null
    }
  }
}

function selectPeriod(period: RankingPeriod): void {
  activePeriod.value = period
  void load(period)
}

onMounted(() => load(activePeriod.value))
onUnmounted(() => controller?.abort())

const cards = computed(() => entries.value.map((entry) => ({ rank: entry.rank, card: toAnimeCardModel(entry.series) })))
</script>

<template>
  <section class="ranking-rail">
    <div class="flex items-center justify-between flex-wrap gap-3 mb-6">
      <h2 class="text-3xl font-bold text-text-primary flex items-center gap-2">
        <Trophy :size="28" class="text-primary" />
        {{ t('home.ranking') }}
      </h2>

      <div class="flex gap-1 glass-light rounded-lg p-1">
        <button
          v-for="period in RANKING_PERIODS"
          :key="period"
          type="button"
          class="px-3 py-1.5 rounded-md text-sm font-medium transition-smooth"
          :class="
            activePeriod === period
              ? 'bg-primary text-white'
              : 'text-text-secondary hover:text-text-primary hover:bg-white/10'
          "
          @click="selectPeriod(period)"
        >
          {{ t(`home.rankingPeriod.${period}`) }}
        </button>
      </div>
    </div>

    <div v-if="error" class="glass-medium rounded-lg p-8 text-center text-text-secondary">
      {{ t('common.error') }}
    </div>

    <div v-else-if="loading" class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
      <SkeletonCard v-for="i in 5" :key="i" />
    </div>

    <div v-else-if="cards.length === 0" class="glass-medium rounded-lg p-8 text-center text-text-secondary">
      {{ t('home.rankingEmpty') }}
    </div>

    <div v-else class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
      <div v-for="item in cards" :key="item.card.id" class="relative">
        <span
          class="absolute -top-2 -left-2 z-10 w-8 h-8 rounded-full bg-primary text-white text-sm font-bold flex items-center justify-center shadow-lg"
        >
          {{ item.rank }}
        </span>
        <AnimeCard :anime="item.card" />
      </div>
    </div>
  </section>
</template>
