<script setup lang="ts">
/**
 * Anime Info
 * Title metadata panel on the detail page.
 *
 * Every field is optional in the catalogue contract, so each block is guarded:
 * a title with no rating, no studio or no synopsis renders a shorter panel
 * rather than an empty label or "undefined".
 */

import { computed } from 'vue'
import { useLocale } from '@/composables/useLocale'
import { Play, Calendar, Star, TvMinimal, Clock } from 'lucide-vue-next'
import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import type { AnimeDetailModel } from '@/models'

interface Props {
  anime: AnimeDetailModel
  hasEpisodes?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  hasEpisodes: false
})

const emit = defineEmits<{
  watchNow: []
  genreClick: [slug: string]
}>()

const { t } = useLocale()

const statusClass = computed(() => {
  switch (props.anime.status) {
    case 'releasing':
      return 'bg-accent-cyan'
    case 'finished':
      return 'bg-accent-blue'
    case 'not_yet_released':
      return 'bg-accent-purple'
    default:
      return 'bg-dark-600'
  }
})

/** "Wiosna 2024", "2024", or nothing when neither is known. */
const seasonLabel = computed(() => {
  const { season, year } = props.anime
  if (season !== null && year !== null) return `${t(`season.${season}`)} ${String(year)}`
  if (year !== null) return String(year)
  return null
})

const studioNames = computed(() =>
  props.anime.studios
    .filter((studio) => studio.isPrimary)
    .map((studio) => studio.name)
    .join(', ')
)
</script>

<template>
  <div class="flex-1">
    <h1 class="text-4xl md:text-5xl font-bold text-text-primary mb-2">
      {{ anime.title }}
    </h1>

    <p v-if="anime.alternativeTitle" class="text-lg text-text-muted mb-4">
      {{ anime.alternativeTitle }}
    </p>

    <div class="flex flex-wrap items-center gap-4 mb-6">
      <div v-if="anime.rating !== null" class="flex items-center gap-2 glass-medium px-3 py-2 rounded-lg">
        <Star :size="20" class="fill-primary text-primary" />
        <span class="text-text-primary font-semibold">{{ anime.rating.toFixed(1) }}</span>
        <span v-if="anime.ratingCount > 0" class="text-text-muted text-sm">({{ anime.ratingCount }})</span>
      </div>

      <div v-if="seasonLabel" class="flex items-center gap-2 glass-medium px-3 py-2 rounded-lg">
        <Calendar :size="20" class="text-accent-blue" />
        <span class="text-text-secondary">{{ seasonLabel }}</span>
      </div>

      <div v-if="anime.episodeCount !== null" class="flex items-center gap-2 glass-medium px-3 py-2 rounded-lg">
        <TvMinimal :size="20" class="text-accent-purple" />
        <span class="text-text-secondary">{{ anime.episodeCount }} {{ t('anime.episodes') }}</span>
      </div>

      <div v-if="anime.durationMinutes !== null" class="flex items-center gap-2 glass-medium px-3 py-2 rounded-lg">
        <Clock :size="20" class="text-accent-cyan" />
        <span class="text-text-secondary">{{ anime.durationMinutes }} min</span>
      </div>

      <div :class="[statusClass, 'px-3 py-2 rounded-lg text-sm font-semibold text-white']">
        {{ t(`status.${anime.status}`) }}
      </div>

      <div class="px-3 py-2 rounded-lg text-sm font-semibold glass-light text-text-secondary">
        {{ t(`format.${anime.format}`) }}
      </div>
    </div>

    <!-- Genres -->
    <div v-if="anime.genres.length" class="flex flex-wrap gap-2 mb-6">
      <button
        v-for="genre in anime.genres"
        :key="genre.slug"
        type="button"
        class="px-3 py-1 glass-light rounded-md text-sm text-text-secondary hover:glass-medium transition-smooth cursor-pointer"
        @click="emit('genreClick', genre.slug)"
      >
        {{ genre.name }}
      </button>
    </div>

    <!-- Synopsis -->
    <Card v-if="anime.synopsis" variant="glass" class="mb-6">
      <h2 class="text-xl font-semibold text-text-primary mb-3">{{ t('anime.synopsis') }}</h2>
      <p class="text-text-secondary leading-relaxed whitespace-pre-line">{{ anime.synopsis }}</p>
    </Card>

    <!-- Additional Info -->
    <div v-if="studioNames" class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
      <Card variant="flat" padding="sm">
        <div class="text-text-muted text-sm mb-1">{{ t('anime.studios') }}</div>
        <div class="text-text-primary font-semibold">{{ studioNames }}</div>
      </Card>

      <Card v-if="anime.startDate" variant="flat" padding="sm">
        <div class="text-text-muted text-sm mb-1">{{ t('anime.aired') }}</div>
        <div class="text-text-primary font-semibold">{{ anime.startDate }}</div>
      </Card>
    </div>

    <!-- Watch Button -->
    <Button
      v-if="hasEpisodes"
      variant="primary"
      size="lg"
      block
      @click="emit('watchNow')"
    >
      <Play :size="24" class="fill-white" />
      {{ t('anime.watchNow') }}
    </Button>
  </div>
</template>
