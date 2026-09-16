<script setup lang="ts">
/**
 * Anime Card
 * Glassmorphic catalogue card with hover reveal and optional watch progress.
 */

import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Play, Star } from 'lucide-vue-next'
import type { AnimeCardModel } from '@/models'

import Card from '@/components/ui/Card.vue'
import Button from '@/components/ui/Button.vue'
import { useLocale } from '@/composables/useLocale'

const { t } = useLocale()

interface Props {
  anime: AnimeCardModel
  showRating?: boolean
  showEpisodeCount?: boolean
  /** Resume state for the continue-watching rail. */
  watchProgress?: {
    episodeId: string
    positionSeconds: number
    durationSeconds: number | null
  }
}

const props = withDefaults(defineProps<Props>(), {
  showRating: true,
  showEpisodeCount: true,
  watchProgress: undefined
})

const router = useRouter()
const imageLoaded = ref(false)
const imageError = ref(false)

// Titles are addressed by slug: the new catalogue has no numeric ids.
const navigateToAnime = () => {
  router.push({ name: '/anime/[slug]', params: { slug: props.anime.slug } })
}

const onImageLoad = () => {
  imageLoaded.value = true
}

const onImageError = () => {
  imageError.value = true
}

const statusColor = computed(() => {
  switch (props.anime.status) {
    case 'releasing':
      return 'bg-accent-cyan'
    case 'finished':
      return 'bg-accent-blue'
    case 'not_yet_released':
      return 'bg-accent-purple'
    case 'hiatus':
    case 'cancelled':
      return 'bg-dark-500'
    default:
      return 'bg-dark-500'
  }
})

const progressPercent = computed(() => {
  const progress = props.watchProgress
  if (!progress || progress.durationSeconds === null || progress.durationSeconds <= 0) return 0
  return Math.min(100, (progress.positionSeconds / progress.durationSeconds) * 100)
})

const formatTime = (seconds: number): string => {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`
}
</script>

<template>
  <Card
    variant="glass"
    padding="none"
    :hover="false"
    @click="navigateToAnime"
    class="group relative cursor-pointer transition-all duration-300"
  >
    <!-- Cover Image -->
    <div class="relative aspect-[2/3] overflow-hidden rounded-t-lg">
      <!-- Skeleton loader while image loads -->
      <div
        v-if="!imageLoaded && !imageError"
        class="absolute inset-0 bg-dark-800 animate-pulse"
      />

      <img
        v-if="anime.posterUrl"
        :src="anime.posterUrl"
        :alt="anime.title"
        :class="[
          'w-full h-full object-cover transition-all duration-300 group-hover:brightness-125 group-hover:contrast-110',
          { 'opacity-0': !imageLoaded, 'opacity-100': imageLoaded }
        ]"
        loading="lazy"
        @load="onImageLoad"
        @error="onImageError"
      />

      <!-- Missing or failed artwork. Poster is optional in the catalogue. -->
      <div
        v-if="imageError || !anime.posterUrl"
        class="absolute inset-0 bg-dark-800 flex items-center justify-center p-3 text-center"
      >
        <span class="text-text-muted text-sm">{{ t('common.imageUnavailable') }}</span>
      </div>

      <template v-if="imageLoaded || !anime.posterUrl">
        <!-- Status Badge -->
        <div
          :class="[statusColor, 'absolute top-2 left-2 px-2 py-1 rounded-md text-xs font-semibold text-white backdrop-blur-sm']"
        >
          {{ t(`status.${anime.status}`) }}
        </div>

        <!-- Rating Badge -->
        <div
          v-if="showRating && anime.rating !== null"
          class="absolute top-2 right-2 glass-strong px-2 py-1 rounded-md text-xs font-semibold flex items-center gap-1"
        >
          <Star :size="14" class="fill-primary text-primary" />
          <span>{{ anime.rating.toFixed(1) }}</span>
        </div>

        <!-- Hover Overlay -->
        <div
          class="absolute inset-0 bg-gradient-to-t from-dark-900 via-dark-900/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center"
        >
          <Button variant="primary" size="lg" icon>
            <Play :size="24" class="fill-white" />
          </Button>
        </div>
      </template>
    </div>

    <!-- Info Section -->
    <div class="p-3">
      <h3 class="font-bold text-base text-text-primary truncate-1 mb-1" :title="anime.title">
        {{ anime.title }}
      </h3>

      <p
        v-if="anime.alternativeTitle"
        class="text-xs text-text-muted truncate-1 mb-1"
        :title="anime.alternativeTitle"
      >
        {{ anime.alternativeTitle }}
      </p>

      <div class="flex items-center justify-between text-xs text-text-secondary">
        <span>{{ anime.year ?? t(`format.${anime.format}`) }}</span>
        <span v-if="showEpisodeCount && anime.episodeCount !== null">
          {{ t('common.episodesCount', { count: anime.episodeCount }) }}
        </span>
      </div>

      <!-- Genres -->
      <div v-if="anime.genres.length" class="flex flex-wrap gap-1 mt-2">
        <span
          v-for="genre in anime.genres.slice(0, 2)"
          :key="genre.slug"
          class="px-2 py-0.5 rounded-md bg-dark-600 text-text-muted text-xs"
        >
          {{ genre.name }}
        </span>
      </div>

      <!-- Watch Progress -->
      <div v-if="watchProgress && progressPercent > 0" class="mt-3">
        <div class="flex items-center justify-between text-xs text-text-muted mb-1">
          <span>{{ t('common.watching') }}</span>
          <span v-if="watchProgress.durationSeconds !== null">
            {{ formatTime(watchProgress.positionSeconds) }} / {{ formatTime(watchProgress.durationSeconds) }}
          </span>
        </div>
        <div class="w-full h-1.5 bg-dark-600 rounded-full overflow-hidden">
          <div
            class="h-full bg-primary rounded-full transition-all duration-300"
            :style="{ width: `${Math.min(progressPercent, 100)}%` }"
          />
        </div>
        <div class="text-xs text-primary font-semibold mt-1">
          {{ Math.round(progressPercent) }}% {{ t('common.completed') }}
        </div>
      </div>
    </div>
  </Card>
</template>
