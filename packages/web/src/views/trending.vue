<script setup lang="ts">
/**
 * Popular titles.
 *
 * The backend has no separate "trending" endpoint — popularity is one of the
 * catalogue's index-backed sort orders. This page is therefore the catalogue
 * listing pinned to that sort, rather than a second, differently-shaped API.
 */

import { onMounted, onUnmounted } from 'vue'
import { TrendingUp } from 'lucide-vue-next'
import { useAnimeCatalogue } from '@/composables/useAnimeCatalogue'
import { useLocale } from '@/composables/useLocale'
import { usePageTitle } from '@/composables/usePageTitle'
import AnimeGrid from '@/components/shared/AnimeGrid.vue'
import LoadMore from '@/components/shared/LoadMore.vue'

definePage({
  meta: {
    icon: TrendingUp,
    label: 'nav.trending',
    showInNav: true,
    order: 3
  }
})

const { t } = useLocale()

usePageTitle(() => t('pageTitle.trending'))

const { items, isLoading, isLoadingMore, hasMore, error, load, loadMore, dispose } = useAnimeCatalogue()

onMounted(() => {
  void load({ sort: 'popularity', limit: 24 })
})

onUnmounted(dispose)
</script>

<template>
  <div class="trending container mx-auto px-4 py-8">
    <h1 class="text-4xl font-bold text-text-primary mb-2">{{ t('nav.trending') }}</h1>
    <p class="text-text-secondary mb-8">{{ t('home.trending') }}</p>

    <div
      v-if="error"
      class="mb-8 p-4 rounded-lg bg-red-500/20 border border-red-500/50 text-red-300"
    >
      {{ error.message }}
    </div>

    <div class="mb-8">
      <AnimeGrid
        :anime-list="items"
        :loading="isLoading"
        :columns="{ default: 2, md: 3, lg: 4, xl: 6 }"
      />
    </div>

    <LoadMore
      :has-more="hasMore"
      :loading="isLoadingMore"
      :loaded-count="items.length"
      @load-more="loadMore"
    />
  </div>
</template>
