<script setup lang="ts">
/**
 * Anime Info
 * Title metadata panel on the detail page.
 *
 * The series carries the title/rating/synopsis fallback; the selected entry
 * (a season, movie, OVA...) carries everything else — format, dates, episode
 * count, genres/tags/studios. A series' own `synopsis` is shown only when
 * the entry has none of its own, since most series have no separate blurb.
 *
 * Every field is optional in the catalogue contract, so each block is
 * guarded: a title with no rating, no studio or no synopsis renders a
 * shorter panel rather than an empty label or "undefined".
 */

import { computed } from 'vue'
import { useLocale } from '@/composables/useLocale'
import { Play, Calendar, Star, TvMinimal, Clock } from 'lucide-vue-next'
import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import LibraryStatusControl from '@/components/features/LibraryStatusControl.vue'
import type { EntryDetailModel, SeriesDetailModel } from '@/models'

interface Props {
  series: SeriesDetailModel
  entry: EntryDetailModel | null
  hasEpisodes?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  hasEpisodes: false
})

const emit = defineEmits<{
  watchNow: []
  genreClick: [slug: string]
  tagClick: [slug: string]
}>()

const { t } = useLocale()

const statusClass = computed(() => {
  switch (props.entry?.status) {
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
  const entry = props.entry
  if (entry === null) return null
  const { airingSeason, airingYear } = entry
  if (airingSeason !== null && airingYear !== null) return `${t(`season.${airingSeason}`)} ${String(airingYear)}`
  if (airingYear !== null) return String(airingYear)
  return null
})

const studioNames = computed(() =>
  (props.entry?.studios ?? [])
    .filter((studio) => studio.isPrimary)
    .map((studio) => studio.name)
    .join(', ')
)

/** The entry's own blurb, falling back to the series' curated one when the entry has none. */
const synopsis = computed(() => props.entry?.synopsis ?? props.series.synopsis)
</script>

<template>
  <div class="flex-1">
    <h1 class="text-4xl md:text-5xl font-bold text-text-primary mb-2">
      {{ series.title }}
    </h1>

    <p v-if="entry && entry.title !== series.title" class="text-lg text-text-muted mb-4">
      {{ entry.title }}
    </p>

    <div class="flex flex-wrap items-center gap-4 mb-6">
      <div v-if="series.rating !== null" class="flex items-center gap-2 glass-medium px-3 py-2 rounded-lg">
        <Star :size="20" class="fill-primary text-primary" />
        <span class="text-text-primary font-semibold">{{ series.rating.toFixed(1) }}</span>
        <span v-if="series.ratingCount > 0" class="text-text-muted text-sm">({{ series.ratingCount }})</span>
      </div>

      <div
        v-if="series.anilistScore !== null"
        class="flex items-center gap-2 glass-medium px-3 py-2 rounded-lg text-accent-blue"
        :title="t('anime.anilistScore')"
      >
        <span class="font-bold text-sm">AL</span>
        <span class="font-semibold">{{ series.anilistScore.toFixed(1) }}</span>
      </div>

      <div v-if="seasonLabel" class="flex items-center gap-2 glass-medium px-3 py-2 rounded-lg">
        <Calendar :size="20" class="text-accent-blue" />
        <span class="text-text-secondary">{{ seasonLabel }}</span>
      </div>

      <div v-if="entry && entry.episodeCount !== null" class="flex items-center gap-2 glass-medium px-3 py-2 rounded-lg">
        <TvMinimal :size="20" class="text-accent-purple" />
        <span class="text-text-secondary">{{ entry.episodeCount }} {{ t('anime.episodes') }}</span>
      </div>

      <div v-if="entry && entry.durationMinutes !== null" class="flex items-center gap-2 glass-medium px-3 py-2 rounded-lg">
        <Clock :size="20" class="text-accent-cyan" />
        <span class="text-text-secondary">{{ entry.durationMinutes }} min</span>
      </div>

      <div v-if="entry" :class="[statusClass, 'px-3 py-2 rounded-lg text-sm font-semibold text-white']">
        {{ t(`status.${entry.status}`) }}
      </div>

      <div v-if="entry" class="px-3 py-2 rounded-lg text-sm font-semibold glass-light text-text-secondary">
        {{ t(`format.${entry.entryType}`) }}
      </div>

      <LibraryStatusControl :anime-id="series.id" class="w-fit" />
    </div>

    <!-- Genres -->
    <div v-if="entry && entry.tags.length === 0 && series.genres.length" class="flex flex-wrap gap-2 mb-4">
      <button
        v-for="genre in series.genres"
        :key="genre.slug"
        type="button"
        class="px-3 py-1 glass-light rounded-md text-sm text-text-secondary hover:glass-medium transition-smooth cursor-pointer"
        @click="emit('genreClick', genre.slug)"
      >
        {{ genre.name }}
      </button>
    </div>

    <!-- Tags -->
    <div v-if="entry && entry.tags.length" class="flex flex-wrap gap-2 mb-6">
      <button
        v-for="tag in entry.tags"
        :key="tag.slug"
        type="button"
        class="px-2.5 py-1 rounded-md text-xs text-text-muted border border-white/10 hover:border-white/25 hover:text-text-secondary transition-smooth cursor-pointer"
        @click="emit('tagClick', tag.slug)"
      >
        {{ tag.name }}
      </button>
    </div>

    <!-- Synopsis -->
    <Card v-if="synopsis" variant="glass" class="mb-6">
      <h2 class="text-xl font-semibold text-text-primary mb-3">{{ t('anime.synopsis') }}</h2>
      <p class="text-text-secondary leading-relaxed whitespace-pre-line">{{ synopsis }}</p>
    </Card>

    <!-- Additional Info -->
    <div v-if="studioNames || entry?.startDate" class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
      <Card v-if="studioNames" variant="flat" padding="sm">
        <div class="text-text-muted text-sm mb-1">{{ t('anime.studios') }}</div>
        <div class="text-text-primary font-semibold">{{ studioNames }}</div>
      </Card>

      <Card v-if="entry?.startDate" variant="flat" padding="sm">
        <div class="text-text-muted text-sm mb-1">{{ t('anime.aired') }}</div>
        <div class="text-text-primary font-semibold">{{ entry.startDate }}</div>
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
