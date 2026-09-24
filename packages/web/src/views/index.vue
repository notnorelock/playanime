<script setup lang="ts">
/**
 * Home / discovery.
 *
 * Every rail below maps to one backend query. The catalogue is sorted and
 * filtered server-side against its indexes, so the page issues a handful of
 * parallel requests and renders what comes back — it never pulls a large slice
 * of the catalogue to re-sort it in the browser.
 */

import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Home } from 'lucide-vue-next'
import type { ContinueWatchingItem } from '@playanime/contracts'
import { AbortError, animeApi, libraryApi } from '@/api'
import { toAnimeCardModel, toSeriesDetailModel, type AnimeCardModel, type SeriesDetailModel } from '@/models'
import { useLocale } from '@/composables/useLocale'
import { useAuthStore } from '@/store/auth'
import { usePageTitle } from '@/composables/usePageTitle'
import FeaturedHero from '@/components/features/FeaturedHero.vue'
import AnimeGrid from '@/components/shared/AnimeGrid.vue'
import RankingRail from '@/components/features/RankingRail.vue'
import AnnouncementBanner from '@/components/features/AnnouncementBanner.vue'

definePage({
  meta: {
    icon: Home,
    label: 'nav.home',
    showInNav: true,
    order: 1
  }
})

const router = useRouter()
const { t } = useLocale()
const authStore = useAuthStore()

usePageTitle(() => t('pageTitle.home'))

/** Titles carried by the hero carousel. */
const HERO_COUNT = 5
const RAIL_LIMIT = 18

const featured = ref<SeriesDetailModel[]>([])
const popular = ref<AnimeCardModel[]>([])
const recentlyAdded = ref<AnimeCardModel[]>([])
const topRated = ref<AnimeCardModel[]>([])
const continueWatching = ref<AnimeCardModel[]>([])
const watchProgressMap = ref(
  new Map<string, { episodeId: string; positionSeconds: number; durationSeconds: number | null }>()
)

const loading = ref(true)
const isAuthenticated = computed(() => authStore.isAuthenticated)

const controller = new AbortController()

/**
 * The hero needs a synopsis and a banner, which the catalogue summary omits
 * deliberately — it is the hottest response in the product and carries only
 * what a card renders. Detail is therefore fetched for the few hero titles
 * only, in parallel, rather than fattening every listing response.
 */
async function loadHero(slugs: readonly string[]): Promise<void> {
  const details = await Promise.allSettled(
    slugs.map((slug) => animeApi.bySlug(slug, controller.signal))
  )

  featured.value = details
    .filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof animeApi.bySlug>>> =>
      result.status === 'fulfilled'
    )
    .map((result) => toSeriesDetailModel(result.value))
}

function toContinueWatchingCards(items: readonly ContinueWatchingItem[]): void {
  const progress = new Map<
    string,
    { episodeId: string; positionSeconds: number; durationSeconds: number | null }
  >()

  for (const item of items) {
    progress.set(item.series.id, {
      episodeId: item.episode.id,
      positionSeconds: item.positionSeconds,
      durationSeconds: item.durationSeconds ?? item.episode.durationSeconds
    })
  }

  watchProgressMap.value = progress
  continueWatching.value = items.map((item) => toAnimeCardModel(item.series))
}

onMounted(async () => {
  loading.value = true

  try {
    // Issued together: these rails are independent, and running them in series
    // would make the page as slow as the sum of its sections.
    const [popularPage, recentPage, topRatedPage] = await Promise.all([
      animeApi.list({ sort: 'popularity', limit: RAIL_LIMIT }, controller.signal),
      animeApi.list({ sort: 'newest', limit: RAIL_LIMIT }, controller.signal),
      animeApi.list({ sort: 'rating', limit: RAIL_LIMIT }, controller.signal)
    ])

    popular.value = popularPage.items.map((item) => toAnimeCardModel(item))
    recentlyAdded.value = recentPage.items.map((item) => toAnimeCardModel(item))
    topRated.value = topRatedPage.items.map((item) => toAnimeCardModel(item))

    await loadHero(popularPage.items.slice(0, HERO_COUNT).map((item) => item.slug))
  } catch (error: unknown) {
    if (!AbortError.is(error)) console.error('Failed to load the home page:', error)
  } finally {
    loading.value = false
  }

  // Progress is per-viewer, so this rail is requested only when there is one.
  if (isAuthenticated.value) {
    try {
      toContinueWatchingCards(await libraryApi.continueWatching(controller.signal))
    } catch (error: unknown) {
      if (!AbortError.is(error)) console.error('Failed to load continue watching:', error)
    }
  }
})

onUnmounted(() => {
  controller.abort()
})

/** Resumes where the viewer stopped, or starts at the first episode. */
const watchNow = async (slug: string) => {
  const title = featured.value.find((item) => item.slug === slug)
  const resume = title === undefined ? undefined : watchProgressMap.value.get(title.id)

  if (resume !== undefined) {
    await router.push({ name: '/watch/[episodeId]', params: { episodeId: resume.episodeId } })
    return
  }

  try {
    const episodes = await animeApi.episodes(slug)
    const first = episodes[0]

    if (first === undefined) {
      await router.push({ name: '/anime/[slug]', params: { slug } })
      return
    }

    await router.push({ name: '/watch/[episodeId]', params: { episodeId: first.id } })
  } catch (error: unknown) {
    console.error('Failed to resolve an episode to play:', error)
    await router.push({ name: '/anime/[slug]', params: { slug } })
  }
}

const viewDetails = (slug: string) => {
  void router.push({ name: '/anime/[slug]', params: { slug } })
}
</script>

<template>
  <div class="home">
    <AnnouncementBanner />

    <!-- Hero Section with Featured Anime -->
    <FeaturedHero
      :featured-anime="featured"
      @watch-now="watchNow"
      @view-details="viewDetails"
    />

    <!-- Continue Watching (authenticated viewers with stored progress) -->
    <section v-if="isAuthenticated && continueWatching.length > 0" class="container mx-auto px-4 py-12">
      <AnimeGrid
        :anime-list="continueWatching"
        :title="t('home.continueWatching')"
        :carousel="true"
        :watch-progress-map="watchProgressMap"
      />
    </section>

    <!-- Ranking — week/month/year/all-time, by distinct viewers -->
    <section class="container mx-auto px-4 py-12">
      <RankingRail />
    </section>

    <!-- Popular -->
    <section class="container mx-auto px-4 py-12">
      <AnimeGrid
        :anime-list="popular"
        :title="t('home.trending')"
        :loading="loading"
        view-all-link="/trending"
        :view-all-text="t('common.viewAll')"
        :carousel="true"
      />
    </section>

    <!-- Recently Added -->
    <section class="container mx-auto px-4 py-12">
      <AnimeGrid
        :anime-list="recentlyAdded"
        :title="t('home.recentlyAdded')"
        :loading="loading"
        view-all-link="/browse"
        :view-all-text="t('common.viewAll')"
        :carousel="true"
      />
    </section>

    <!-- Top Rated -->
    <section class="container mx-auto px-4 py-12">
      <AnimeGrid
        :anime-list="topRated"
        :title="t('home.topRated')"
        :loading="loading"
        view-all-link="/browse"
        :view-all-text="t('common.viewAll')"
        :carousel="true"
      />
    </section>
  </div>
</template>
