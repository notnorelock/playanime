<script setup lang="ts">
/**
 * Catalogue search.
 *
 * Debouncing and request cancellation both live in `useAnimeSearch`; this view
 * only supplies the term and renders the four states a search can be in —
 * idle, loading, empty and failed.
 */

import { computed, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Search } from 'lucide-vue-next'
import { useAnimeSearch } from '@/composables/useAnimeSearch'
import { useLocale } from '@/composables/useLocale'
import { usePageTitle } from '@/composables/usePageTitle'
import SearchInput from '@/components/ui/SearchInput.vue'
import AnimeGrid from '@/components/shared/AnimeGrid.vue'

definePage({
  meta: {
    icon: Search,
    label: 'common.search',
    showInNav: true,
    order: 5
  }
})

const route = useRoute()
const router = useRouter()
const { t } = useLocale()

const initialQuery = typeof route.query['q'] === 'string' ? route.query['q'] : ''
const searchQuery = ref(initialQuery)

const { results, isLoading, hasSearched, error, dispose } = useAnimeSearch(searchQuery)

const pageTitle = computed(() =>
  searchQuery.value ? t('pageTitle.searchQuery', { query: searchQuery.value }) : t('pageTitle.search')
)
usePageTitle(() => pageTitle.value)

// Keeps the term in the URL so a search can be shared or reloaded. `replace`
// avoids stacking one history entry per keystroke.
watch(searchQuery, (value) => {
  const term = value.trim()
  void router.replace({ query: term.length > 0 ? { q: term } : {} })
})

onUnmounted(dispose)
</script>

<template>
  <div class="search container mx-auto px-4 py-8">
    <h1 class="text-4xl font-bold text-text-primary mb-8">{{ t('search.title') }}</h1>

    <!-- Search Input -->
    <div class="max-w-2xl mb-8">
      <SearchInput v-model="searchQuery" :placeholder="t('search.placeholder')" />
    </div>

    <!-- Error -->
    <div
      v-if="error"
      class="mb-8 p-4 rounded-lg bg-red-500/20 border border-red-500/50 text-red-300"
    >
      {{ error.message }}
    </div>

    <!-- Loading: the skeleton grid, not a bare spinner. -->
    <AnimeGrid
      v-else-if="isLoading"
      :anime-list="[]"
      :loading="true"
      :columns="{ default: 2, md: 3, lg: 4, xl: 6 }"
    />

    <!-- Results -->
    <div v-else-if="results.length > 0">
      <h2 class="text-2xl font-semibold text-text-primary mb-4">
        {{ results.length }} {{ t('common.results') }}
      </h2>
      <AnimeGrid :anime-list="results" :columns="{ default: 2, md: 3, lg: 4, xl: 6 }" />
    </div>

    <!-- Searched, found nothing -->
    <p v-else-if="hasSearched" class="text-center text-text-secondary py-12">
      {{ t('search.noResults') }}
    </p>

    <!-- Nothing typed yet -->
    <p v-else class="text-center text-text-secondary py-12">
      {{ t('search.placeholder') }}
    </p>
  </div>
</template>
