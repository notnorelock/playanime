<script setup lang="ts">
/**
 * Featured Hero Component
 * Displays featured anime in a carousel with navigation
 */

import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useLocale } from '@/composables/useLocale'
import { Play, ChevronLeft, ChevronRight, Info } from 'lucide-vue-next'
import Button from '@/components/ui/Button.vue'
import type { AnimeDetailModel } from '@/models'

interface Props {
  /**
   * Full detail models: the hero renders a synopsis and a banner, neither of
   * which the compact catalogue summary carries.
   */
  featuredAnime: AnimeDetailModel[]
  autoRotateInterval?: number
}

const props = withDefaults(defineProps<Props>(), {
  autoRotateInterval: 8000
})

const emit = defineEmits<{
  watchNow: [slug: string]
  viewDetails: [slug: string]
}>()

const { t } = useLocale()
const featuredIndex = ref(0)
const isHovered = ref(false)
const progress = ref(0)

const currentFeatured = computed(() => props.featuredAnime[featuredIndex.value])

const nextFeatured = () => {
  featuredIndex.value = (featuredIndex.value + 1) % props.featuredAnime.length
  progress.value = 0
}

const prevFeatured = () => {
  featuredIndex.value = (featuredIndex.value - 1 + props.featuredAnime.length) % props.featuredAnime.length
  progress.value = 0
}

// Auto-rotate featured anime
let animationFrameId: number | null = null
let lastTimestamp: number = 0
let startTime: number = 0

const startAutoRotate = () => {
  if (props.autoRotateInterval > 0) {
    progress.value = 0
    startTime = performance.now()
    lastTimestamp = startTime
    animateProgress(startTime)
  }
}

const animateProgress = (timestamp: number) => {
  if (!isHovered.value) {
    const elapsed = timestamp - startTime
    progress.value = (elapsed / props.autoRotateInterval) * 100

    if (progress.value >= 100) {
      progress.value = 100
      // Wait for fade-out animation before switching
      setTimeout(() => {
        nextFeatured()
        startTime = performance.now()
        animationFrameId = requestAnimationFrame(animateProgress)
      }, 300) // Match fade-out duration
      return
    }
  }

  animationFrameId = requestAnimationFrame(animateProgress)
}

const stopAutoRotate = () => {
  if (animationFrameId !== null) {
    cancelAnimationFrame(animationFrameId)
    animationFrameId = null
  }
}

const handleMouseEnter = () => {
  isHovered.value = true
}

const handleMouseLeave = () => {
  isHovered.value = false
}

onMounted(() => {
  startAutoRotate()
})

onUnmounted(() => {
  stopAutoRotate()
})
</script>

<template>
  <section
    class="relative h-[70vh] md:h-[80vh] overflow-hidden"
    @mouseenter="handleMouseEnter"
    @mouseleave="handleMouseLeave"
  >
    <!-- Loading Skeleton -->
    <div v-if="!currentFeatured || featuredAnime.length === 0" class="absolute inset-0 bg-dark-800 animate-pulse">
      <div class="absolute inset-0 bg-gradient-to-r from-dark-900 via-dark-900/80 to-transparent"></div>
      <div class="absolute inset-0 bg-gradient-to-t from-dark-900 via-transparent to-transparent"></div>
      <div class="relative container mx-auto px-4 h-full flex items-center">
        <div class="max-w-2xl space-y-6">
          <div class="h-24 bg-dark-700 rounded-lg w-3/4 animate-pulse"></div>
          <div class="flex gap-4">
            <div class="h-8 bg-dark-700 rounded w-24 animate-pulse"></div>
            <div class="h-8 bg-dark-700 rounded w-28 animate-pulse"></div>
            <div class="h-8 bg-dark-700 rounded w-36 animate-pulse"></div>
          </div>
          <div class="space-y-3">
            <div class="h-5 bg-dark-700 rounded w-full animate-pulse"></div>
            <div class="h-5 bg-dark-700 rounded w-5/6 animate-pulse"></div>
            <div class="h-5 bg-dark-700 rounded w-4/6 animate-pulse"></div>
          </div>
          <div class="flex gap-4">
            <div class="h-14 bg-dark-700 rounded w-44 animate-pulse"></div>
            <div class="h-14 bg-dark-700 rounded w-44 animate-pulse"></div>
          </div>
        </div>
      </div>
    </div>

    <!-- Background Image with Parallax -->
    <transition name="fade" mode="out-in">
      <div
        v-if="currentFeatured && featuredAnime.length > 0"
        :key="featuredIndex"
        class="absolute inset-0 transition-opacity duration-1000"
      >
        <img
          v-if="currentFeatured.bannerUrl ?? currentFeatured.posterUrl"
          :src="currentFeatured.bannerUrl ?? currentFeatured.posterUrl ?? undefined"
          :alt="currentFeatured.title"
          class="w-full h-full object-cover"
          loading="lazy"
        />
        <div class="absolute inset-0 bg-gradient-to-r from-dark-900 via-dark-900/80 to-transparent"></div>
        <div class="absolute inset-0 bg-gradient-to-t from-dark-900 via-transparent to-transparent"></div>
      </div>
    </transition>

    <!-- Content -->
    <div v-if="currentFeatured && featuredAnime.length > 0" class="relative container mx-auto px-4 h-full flex items-center">
      <div class="max-w-2xl animate-fade-in">
        <transition name="slide-up" mode="out-in">
          <div :key="featuredIndex">
            <h1 class="text-5xl md:text-7xl font-bold text-text-primary mb-4 text-gradient-primary">
              {{ currentFeatured.title }}
            </h1>

            <div class="flex items-center gap-4 mb-6">
              <span v-if="currentFeatured.rating !== null" class="px-3 py-1 bg-primary rounded-md text-white font-semibold flex items-center gap-2">
                <span>{{ currentFeatured.rating.toFixed(1) }} ⭐</span>
                <span v-if="currentFeatured.ratingCount > 0" class="text-white/70 text-sm">({{ currentFeatured.ratingCount }})</span>
              </span>
              <span v-if="currentFeatured.year !== null" class="text-text-secondary">{{ currentFeatured.year }}</span>
              <span v-if="currentFeatured.episodeCount !== null" class="text-text-secondary">{{ currentFeatured.episodeCount }} {{ t('anime.episodes') }}</span>
            </div>

            <p v-if="currentFeatured.synopsis" class="text-text-secondary text-lg mb-8 line-clamp-3">
              {{ currentFeatured.synopsis }}
            </p>

            <div class="flex flex-wrap gap-4">
              <Button
                variant="primary"
                size="lg"
                @click="emit('watchNow', currentFeatured.slug)"
              >
                <Play :size="20" class="fill-white" />
                {{ t('anime.watchNow') }}
              </Button>
              <Button
                variant="glass"
                size="lg"
                @click="emit('viewDetails', currentFeatured.slug)"
              >
                <Info :size="20" />
                {{ t('anime.synopsis') }}
              </Button>
            </div>
          </div>
        </transition>
      </div>
    </div>

    <!-- Navigation Arrows -->
    <button
      @click="prevFeatured"
      class="absolute left-4 top-1/2 -translate-y-1/2 glass-medium p-3 rounded-full hover:glass-strong transition-smooth z-10"
    >
      <ChevronLeft :size="24" />
    </button>
    <button
      @click="nextFeatured"
      class="absolute right-4 top-1/2 -translate-y-1/2 glass-medium p-3 rounded-full hover:glass-strong transition-smooth z-10"
    >
      <ChevronRight :size="24" />
    </button>

    <!-- Indicators -->
    <div class="absolute bottom-8 left-1/2 -translate-x-1/2 flex gap-2 z-10">
      <button
        v-for="(_, index) in featuredAnime"
        :key="index"
        @click="featuredIndex = index; progress = 0"
        :class="[
          'w-12 h-1 rounded-full transition-smooth relative overflow-hidden',
          index === featuredIndex ? 'bg-glass-medium' : 'bg-glass-medium hover:bg-glass-strong'
        ]"
      >
        <div
          v-if="index === featuredIndex"
          class="absolute inset-0 bg-primary origin-left"
          :style="{
            width: `${progress}%`,
            opacity: progress >= 100 ? 0 : 1,
            transition: `opacity 0.25s ease${isHovered ? '' : ', width 0.25s ease'}`
          }"
        ></div>
      </button>
    </div>
  </section>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 1s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.slide-up-enter-active,
.slide-up-leave-active {
  transition: all 0.5s ease;
}

.slide-up-enter-from {
  opacity: 0;
  transform: translateY(30px);
}

.slide-up-leave-to {
  opacity: 0;
  transform: translateY(-30px);
}

.line-clamp-3 {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
