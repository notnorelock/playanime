<script setup lang="ts">
/**
 * Catalogue browser.
 *
 * Every filter is a backend query parameter, resolved against a database index.
 * Filtering in the browser would require downloading the catalogue first, which
 * is both slow and wrong once it outgrows one page.
 */

import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { LayoutDashboard, Plus } from 'lucide-vue-next'
import {
  ANIME_SORTS,
  RELEASE_STATUSES,
  SEASONS_OF_YEAR,
  TITLE_FORMATS,
  type AnimeGenre,
  type AnimeListQuery,
  type AnimeTag
} from '@playanime/contracts'
import { animeApi } from '@/api'
import { useAnimeCatalogue } from '@/composables/useAnimeCatalogue'
import { useCataloguePermissions } from '@/composables/useCataloguePermissions'
import { useLocale } from '@/composables/useLocale'
import { usePageTitle } from '@/composables/usePageTitle'
import AnimeGrid from '@/components/shared/AnimeGrid.vue'
import LoadMore from '@/components/shared/LoadMore.vue'
import Select from '@/components/ui/Select.vue'
import Button from '@/components/ui/Button.vue'

definePage({
  meta: {
    icon: LayoutDashboard,
    label: 'nav.browse',
    showInNav: true,
    order: 2
  }
})

const route = useRoute()
const router = useRouter()
const { t } = useLocale()

usePageTitle(() => t('pageTitle.browse'))

const { items, isLoading, isLoadingMore, hasMore, error, load, loadMore, dispose } = useAnimeCatalogue()
const { permissions, load: loadPermissions } = useCataloguePermissions()
const genres = ref<AnimeGenre[]>([])
const tags = ref<AnimeTag[]>([])

/** Reads a single query-string value, ignoring repeated parameters. */
function queryParam(key: string): string {
  const value = route.query[key]
  if (Array.isArray(value)) return value[0] ?? ''
  return typeof value === 'string' ? value : ''
}

/** Sentinel for "no filter". Empty string is what Select renders as a value. */
const ALL = ''

const genre = ref(queryParam('genre'))
const tag = ref(queryParam('tag'))
const format = ref(queryParam('format'))
const status = ref(queryParam('status'))
const season = ref(queryParam('season'))
const seasonYear = ref(queryParam('seasonYear'))
const sort = ref(queryParam('sort') || 'popularity')

const genreOptions = computed(() => [
  { label: t('common.all'), value: ALL },
  ...genres.value.map((item) => ({ label: item.name, value: item.slug }))
])

const tagOptions = computed(() => [
  { label: t('common.all'), value: ALL },
  ...tags.value.map((item) => ({ label: item.name, value: item.slug }))
])

const formatOptions = computed(() => [
  { label: t('common.all'), value: ALL },
  ...TITLE_FORMATS.map((value) => ({ label: t(`format.${value}`), value }))
])

const statusOptions = computed(() => [
  { label: t('common.all'), value: ALL },
  ...RELEASE_STATUSES.map((value) => ({ label: t(`status.${value}`), value }))
])

const seasonOptions = computed(() => [
  { label: t('common.all'), value: ALL },
  ...SEASONS_OF_YEAR.map((value) => ({ label: t(`season.${value}`), value }))
])

const sortOptions = computed(() =>
  ANIME_SORTS.map((value) => ({ label: t(`sort.${value}`), value }))
)

/** Recent broadcast years, newest first. */
const yearOptions = computed(() => {
  const current = new Date().getFullYear()
  const years = Array.from({ length: 30 }, (_, index) => current + 1 - index)
  return [
    { label: t('common.all'), value: ALL },
    ...years.map((year) => ({ label: String(year), value: String(year) }))
  ]
})

const hasFilters = computed(
  () =>
    genre.value !== ALL ||
    tag.value !== ALL ||
    format.value !== ALL ||
    status.value !== ALL ||
    season.value !== ALL ||
    seasonYear.value !== ALL ||
    sort.value !== 'popularity'
)

/** Builds the API query, omitting every unset filter. */
function buildQuery(): AnimeListQuery {
  const parsedYear = Number.parseInt(seasonYear.value, 10)

  return {
    limit: 24,
    ...(genre.value === ALL ? {} : { genre: genre.value }),
    ...(tag.value === ALL ? {} : { tag: tag.value }),
    ...(format.value === ALL ? {} : { format: format.value as AnimeListQuery['format'] }),
    ...(status.value === ALL ? {} : { status: status.value as AnimeListQuery['status'] }),
    ...(season.value === ALL ? {} : { season: season.value as AnimeListQuery['season'] }),
    ...(Number.isFinite(parsedYear) ? { seasonYear: parsedYear } : {}),
    ...(sort.value === ALL ? {} : { sort: sort.value as AnimeListQuery['sort'] })
  }
}

/**
 * Mirrors the filters into the URL so a filtered view can be shared or
 * reloaded. `replace` rather than `push`: adjusting a dropdown should not add
 * an entry the viewer then has to click back through.
 */
function syncUrl(): void {
  void router.replace({
    query: {
      ...(genre.value === ALL ? {} : { genre: genre.value }),
      ...(tag.value === ALL ? {} : { tag: tag.value }),
      ...(format.value === ALL ? {} : { format: format.value }),
      ...(status.value === ALL ? {} : { status: status.value }),
      ...(season.value === ALL ? {} : { season: season.value }),
      ...(seasonYear.value === ALL ? {} : { seasonYear: seasonYear.value }),
      ...(sort.value === 'popularity' ? {} : { sort: sort.value })
    }
  })
}

function applyFilters(): void {
  syncUrl()
  void load(buildQuery())
}

function resetFilters(): void {
  genre.value = ALL
  tag.value = ALL
  format.value = ALL
  status.value = ALL
  season.value = ALL
  seasonYear.value = ALL
  sort.value = 'popularity'
}

watch([genre, tag, format, status, season, seasonYear, sort], applyFilters)

onMounted(async () => {
  void load(buildQuery())
  void loadPermissions()

  try {
    genres.value = await animeApi.genres()
  } catch (cause: unknown) {
    // Genres refine the listing but are not required by it: a failure here
    // leaves the filter empty rather than breaking the page.
    console.error('Failed to load genres:', cause)
  }

  try {
    tags.value = await animeApi.tags()
  } catch (cause: unknown) {
    console.error('Failed to load tags:', cause)
  }
})

onUnmounted(dispose)
</script>

<template>
  <div class="browse container mx-auto px-4 py-8">
    <div class="flex items-center justify-between gap-4 mb-8 flex-wrap">
      <h1 class="text-4xl font-bold text-text-primary">{{ t('nav.browse') }}</h1>

      <router-link
        v-if="permissions.canCreateAnime"
        to="/catalogue/create"
        class="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg font-semibold hover:bg-primary-hover transition-colors"
      >
        <Plus :size="20" />
        {{ t('catalogue.createTitle') }}
      </router-link>
    </div>

    <!-- Filters -->
    <div class="glass-medium rounded-2xl p-4 mb-8 flex flex-wrap items-end gap-3">
      <div class="min-w-40 flex-1">
        <label class="block text-xs text-text-muted mb-1">{{ t('anime.genres') }}</label>
        <Select v-model="genre" :options="genreOptions" size="sm" />
      </div>
      <div class="min-w-40 flex-1">
        <label class="block text-xs text-text-muted mb-1">{{ t('anime.tags') }}</label>
        <Select v-model="tag" :options="tagOptions" size="sm" />
      </div>
      <div class="min-w-36 flex-1">
        <label class="block text-xs text-text-muted mb-1">{{ t('anime.type') }}</label>
        <Select v-model="format" :options="formatOptions" size="sm" />
      </div>
      <div class="min-w-36 flex-1">
        <label class="block text-xs text-text-muted mb-1">{{ t('anime.status') }}</label>
        <Select v-model="status" :options="statusOptions" size="sm" />
      </div>
      <div class="min-w-36 flex-1">
        <label class="block text-xs text-text-muted mb-1">{{ t('anime.season') }}</label>
        <Select v-model="season" :options="seasonOptions" size="sm" />
      </div>
      <div class="min-w-32 flex-1">
        <label class="block text-xs text-text-muted mb-1">{{ t('anime.year') }}</label>
        <Select v-model="seasonYear" :options="yearOptions" size="sm" />
      </div>
      <div class="min-w-36 flex-1">
        <label class="block text-xs text-text-muted mb-1">{{ t('sort.label') }}</label>
        <Select v-model="sort" :options="sortOptions" size="sm" />
      </div>

      <Button v-if="hasFilters" variant="ghost" size="sm" @click="resetFilters">
        {{ t('common.reset') }}
      </Button>
    </div>

    <!-- Error -->
    <div
      v-if="error"
      class="mb-8 p-4 rounded-lg bg-red-500/20 border border-red-500/50 text-red-300"
    >
      {{ error.message }}
    </div>

    <!-- Results -->
    <div class="mb-8">
      <AnimeGrid
        :anime-list="items"
        :loading="isLoading"
        :columns="{ default: 2, md: 3, lg: 4, xl: 6 }"
      />
    </div>

    <p
      v-if="!isLoading && items.length === 0 && !error"
      class="text-center text-text-secondary py-12"
    >
      {{ t('search.noResults') }}
    </p>

    <LoadMore
      :has-more="hasMore"
      :loading="isLoadingMore"
      :loaded-count="items.length"
      @load-more="loadMore"
    />
  </div>
</template>
