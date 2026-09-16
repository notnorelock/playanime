<script setup lang="ts">
/**
 * AnimeSection Component
 * Reusable section for displaying anime grids
 */

import type { Anime } from '@/types'
import AnimeCard from '@/components/shared/AnimeCard.vue'

interface Props {
  title: string
  items: Anime[]
  viewAllLink?: string
}

defineProps<Props>()
</script>

<template>
  <section class="container mx-auto px-4 py-12">
    <div class="flex items-center justify-between mb-6">
      <h2 class="text-3xl font-bold text-white">{{ title }}</h2>
      <router-link
        v-if="viewAllLink"
        :to="viewAllLink"
        class="text-primary hover:text-primary-hover transition-colors"
      >
        Zobacz wszystkie
      </router-link>
    </div>

    <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6 gap-4">
      <AnimeCard
        v-for="anime in items"
        :key="anime.id"
        :anime="anime"
      />
    </div>
  </section>
</template>
