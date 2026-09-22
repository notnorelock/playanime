<script setup lang="ts">
/**
 * Episode Card
 * One episode, with its watch progress where the viewer has any.
 *
 * The catalogue has no per-episode artwork, so the title's poster stands in.
 * Nothing here fabricates a thumbnail URL — an episode without an image shows
 * the fallback panel rather than a broken one.
 */

import { computed, ref } from 'vue'
import { useLocale } from '@/composables/useLocale'
import { Check, Crown, Lock, Play } from 'lucide-vue-next'
import Card from '@/components/ui/Card.vue'
import type { EpisodeCardModel } from '@/models'

interface Props {
  episode: EpisodeCardModel
  /** Fallback artwork, normally the title's poster. */
  coverImage?: string | null
  isActive?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  coverImage: null,
  isActive: false
})

const emit = defineEmits<{
  click: []
}>()

const { t } = useLocale()
const imageLoaded = ref(false)
const imageError = ref(false)

const thumbnail = computed(() => props.coverImage)
const hasImage = computed(() => thumbnail.value !== null && !imageError.value)

const onImageLoad = () => {
  imageLoaded.value = true
}

const onImageError = () => {
  imageError.value = true
}

const formatDuration = (seconds: number): string => {
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = Math.floor(seconds % 60)
  return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`
}
</script>

<template>
  <Card
    variant="glass"
    padding="none"
    @click="emit('click')"
    :class="['group cursor-pointer', isActive ? 'ring-2 ring-primary' : '']"
  >
    <div class="relative aspect-video overflow-hidden">
      <div v-if="hasImage && !imageLoaded" class="absolute inset-0 bg-dark-800 animate-pulse" />

      <img
        v-if="hasImage"
        :src="thumbnail ?? undefined"
        :alt="episode.title"
        :class="[
          'w-full h-full object-cover transition-all duration-300',
          { 'opacity-0': !imageLoaded, 'opacity-100': imageLoaded }
        ]"
        loading="lazy"
        @load="onImageLoad"
        @error="onImageError"
      />

      <div v-else class="absolute inset-0 bg-dark-800" />

      <div
        class="absolute inset-0 transition-opacity flex items-center justify-center"
        :class="isActive ? 'bg-primary/20' : 'bg-dark-900/60 opacity-0 group-hover:opacity-100'"
      >
        <div v-if="isActive" class="glass-strong px-3 py-1 rounded-lg text-sm font-semibold">
          {{ t('player.play') }}
        </div>
        <Lock v-else-if="episode.requiresVip" :size="40" class="text-white" />
        <Play v-else :size="48" class="fill-white text-white" />
      </div>

      <!-- Filler, recap and VIP are flagged so a viewer knows before clicking in. -->
      <div v-if="episode.isFiller || episode.isRecap || episode.requiresVip" class="absolute top-2 left-2 flex gap-1">
        <span
          v-if="episode.requiresVip"
          class="inline-flex items-center gap-1 bg-primary/90 text-white px-2 py-0.5 rounded text-xs font-medium"
        >
          <Crown :size="12" />
          {{ t('admin.dashboard.vip.badge') }}
        </span>
        <span v-if="episode.isFiller" class="glass-strong px-2 py-0.5 rounded text-xs">
          {{ t('anime.filler') }}
        </span>
        <span v-if="episode.isRecap" class="glass-strong px-2 py-0.5 rounded text-xs">
          {{ t('anime.recap') }}
        </span>
      </div>

      <div
        v-if="episode.isCompleted"
        class="absolute top-2 right-2 bg-primary rounded-full p-1"
        :title="t('common.completed')"
      >
        <Check :size="14" class="text-white" />
      </div>

      <div
        v-if="episode.durationSeconds !== null"
        class="absolute bottom-2 right-2 glass-strong px-2 py-1 rounded text-xs"
      >
        {{ formatDuration(episode.durationSeconds) }}
      </div>

      <!-- Resume bar -->
      <div
        v-if="episode.progressPercent !== null && episode.progressPercent > 0"
        class="absolute bottom-0 left-0 right-0 h-1 bg-dark-900/70"
      >
        <div
          class="h-full bg-primary transition-all duration-300"
          :style="{ width: `${Math.min(episode.progressPercent, 100)}%` }"
        />
      </div>
    </div>

    <div class="p-3">
      <div class="text-primary text-sm font-semibold mb-1">
        {{ t('anime.episode') }} {{ episode.number }}
      </div>
      <h3 class="text-text-primary font-medium truncate-1" :title="episode.title">
        {{ episode.title }}
      </h3>
    </div>
  </Card>
</template>
