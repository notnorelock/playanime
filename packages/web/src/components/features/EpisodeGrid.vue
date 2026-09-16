<script setup lang="ts">
/**
 * Episode Grid
 * Episode listing for the detail and watch pages.
 */

import { useLocale } from '@/composables/useLocale'
import EpisodeCard from '@/components/features/EpisodeCard.vue'
import type { EpisodeCardModel } from '@/models'

interface Props {
  episodes: EpisodeCardModel[]
  coverImage?: string | null
  /** Episode ids are server-issued uuids; nothing is generated client-side. */
  currentEpisodeId?: string | null
  title?: string
  showTitle?: boolean
}

withDefaults(defineProps<Props>(), {
  coverImage: null,
  currentEpisodeId: null,
  showTitle: true
})

const emit = defineEmits<{
  episodeClick: [episodeId: string]
}>()

const { t } = useLocale()
</script>

<template>
  <section v-if="episodes.length > 0" class="episode-grid">
    <h2 v-if="showTitle" class="text-3xl font-bold text-text-primary mb-6">
      {{ title ?? t('anime.episodes') }}
    </h2>

    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      <EpisodeCard
        v-for="episode in episodes"
        :key="episode.id"
        :episode="episode"
        :cover-image="coverImage"
        :is-active="episode.id === currentEpisodeId"
        @click="emit('episodeClick', episode.id)"
      />
    </div>
  </section>
</template>
