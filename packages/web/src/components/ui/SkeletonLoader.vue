<script setup lang="ts">
/**
 * Dynamic Skeleton Loader
 * Renders appropriate skeleton based on route name
 */

import { computed } from 'vue'
import SkeletonHero from './SkeletonHero.vue'
import SkeletonGrid from './SkeletonGrid.vue'
import SkeletonAnimeDetail from './SkeletonAnimeDetail.vue'
import SkeletonVideoPlayer from './SkeletonVideoPlayer.vue'
import SkeletonTranslatorCard from './SkeletonTranslatorCard.vue'

interface Props {
  routeName?: string | symbol | null | undefined
}

const props = defineProps<Props>()

const skeletonType = computed(() => {
  const route = props.routeName as string

  switch (route) {
    case 'home':
      return 'home'
    case 'anime-detail':
      return 'anime-detail'
    case 'watch':
      return 'watch'
    case 'translators':
    case 'translator-profile':
      return 'translators'
    default:
      return 'grid'
  }
})
</script>

<template>
  <div class="skeleton-loader">
    <!-- Home with Hero -->
    <template v-if="skeletonType === 'home'">
      <div class="space-y-12">
        <SkeletonHero />
        <SkeletonGrid :count="6" />
      </div>
    </template>

    <!-- Anime Detail -->
    <SkeletonAnimeDetail v-else-if="skeletonType === 'anime-detail'" />

    <!-- Watch/Video Player -->
    <SkeletonVideoPlayer v-else-if="skeletonType === 'watch'" />

    <!-- Translators -->
    <div v-else-if="skeletonType === 'translators'" class="space-y-6">
      <div class="h-10 bg-dark-800 rounded w-48 mb-8 animate-pulse" />
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <SkeletonTranslatorCard v-for="i in 6" :key="i" />
      </div>
    </div>

    <!-- Default Grid -->
    <div v-else class="space-y-8">
      <div class="h-10 bg-dark-800 rounded w-64 mb-8 animate-pulse" />
      <SkeletonGrid :count="12" />
    </div>
  </div>
</template>

<style scoped>
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.animate-pulse {
  animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}
</style>
