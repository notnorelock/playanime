<script setup lang="ts">
/**
 * Hero Carousel Component
 * Featured anime carousel with auto-rotation
 */

import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useLocale } from '@/composables/useLocale'
import { Play, ChevronLeft, ChevronRight, Info } from 'lucide-vue-next'
import Button from '@/components/ui/Button.vue'
import type { Anime } from '@/types'

interface Props {
  items: Anime[]
  autoRotate?: boolean
  rotateInterval?: number
}

const props = withDefaults(defineProps<Props>(), {
  autoRotate: true,
  rotateInterval: 8000
})

const router = useRouter()
const { t } = useLocale()

const currentIndex = ref(0)
const currentItem = computed(() => props.items[currentIndex.value])

let autoRotateTimer: ReturnType<typeof setInterval> | null = null

const next = () => {
  currentIndex.value = (currentIndex.value + 1) % props.items.length
}

const prev = () => {
  currentIndex.value = (currentIndex.value - 1 + props.items.length) % props.items.length
}

const goTo = (index: number) => {
  currentIndex.value = index
}

const emit = defineEmits<{
  watchNow: [animeId: number]
  viewDetails: [animeId: number]
}>()

const handleWatchNow = () => {
  if (currentItem.value) {
    emit('watchNow', currentItem.value.id)
  }
}

const handleViewDetails = () => {
  if (currentItem.value) {
    emit('viewDetails', currentItem.value.id)
  }
}

onMounted(() => {
  if (props.autoRotate && props.items.length > 1) {
    autoRotateTimer = setInterval(next, props.rotateInterval)
  }
})

onUnmounted(() => {
  if (autoRotateTimer) {
    clearInterval(autoRotateTimer)
  }
})
</script>

<template>
  <section class="relative h-[70vh] md:h-[80vh] overflow-hidden">
    <!-- Loading Skeleton -->
    <div v-if="!currentItem || items.length === 0" class="absolute inset-0 bg-dark-800 animate-pulse">
      <div class="absolute inset-0 bg-gradient-to-r from-dark-900 via-dark-900/80 to-transparent"></div>
      <div class="absolute inset-0 bg-gradient-to-t from-dark-900 via-transparent to-transparent"></div>
      <div class="relative container mx-auto px-4 h-full flex items-center">
        <div class="max-w-2xl space-y-6">
          <div class="h-20 bg-dark-700 rounded-lg w-3/4 animate-pulse"></div>
          <div class="flex gap-4">
            <div class="h-8 bg-dark-700 rounded w-20 animate-pulse"></div>
            <div class="h-8 bg-dark-700 rounded w-24 animate-pulse"></div>
            <div class="h-8 bg-dark-700 rounded w-32 animate-pulse"></div>
          </div>
          <div class="space-y-3">
            <div class="h-4 bg-dark-700 rounded w-full animate-pulse"></div>
            <div class="h-4 bg-dark-700 rounded w-5/6 animate-pulse"></div>
            <div class="h-4 bg-dark-700 rounded w-4/6 animate-pulse"></div>
          </div>
          <div class="flex gap-4">
            <div class="h-12 bg-dark-700 rounded w-40 animate-pulse"></div>
            <div class="h-12 bg-dark-700 rounded w-40 animate-pulse"></div>
          </div>
        </div>
      </div>
    </div>

    <!-- Background Image -->
    <transition name="fade" mode="out-in">
      <div
        v-if="currentItem && items.length > 0"
        :key="currentIndex"
        class="absolute inset-0 transition-opacity duration-1000"
      >
        <img
          :src="currentItem.cover_url"
          :alt="currentItem.title"
          class="w-full h-full object-cover"
        />
        <div class="absolute inset-0 bg-gradient-to-r from-dark-900 via-dark-900/80 to-transparent"></div>
        <div class="absolute inset-0 bg-gradient-to-t from-dark-900 via-transparent to-transparent"></div>
      </div>
    </transition>

    <!-- Content -->
    <div class="relative container mx-auto px-4 h-full flex items-center">
      <div class="max-w-2xl">
        <transition name="slide-up" mode="out-in">
          <div v-if="currentItem" :key="currentIndex">
            <h1 class="text-5xl md:text-7xl font-bold mb-4 text-gradient-primary">
              {{ currentItem.title }}
            </h1>

            <div class="flex items-center gap-4 mb-6">
              <span v-if="currentItem.stats?.average_rating" class="px-3 py-1 bg-primary rounded-md text-white font-semibold flex items-center gap-2">
                <span>{{ currentItem.stats.average_rating.toFixed(1) }} ⭐</span>
                <span v-if="currentItem.stats.rating_count" class="text-white/70 text-sm">({{ currentItem.stats.rating_count }})</span>
              </span>
              <span class="text-white/70">{{ currentItem.release_year }}</span>
              <span class="text-white/70">{{ currentItem.total_episodes }} {{ t('anime.episodes') }}</span>
            </div>

            <p class="text-white/70 text-lg mb-8 line-clamp-3">
              {{ currentItem.synopsis }}
            </p>

            <div class="flex flex-wrap gap-4">
              <Button variant="primary" size="lg" @click="handleWatchNow">
                <Play :size="20" class="fill-white" />
                {{ t('anime.watchNow') }}
              </Button>
              <Button variant="glass" size="lg" @click="handleViewDetails">
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
      v-if="items.length > 1"
      @click="prev"
      class="absolute left-4 top-1/2 -translate-y-1/2 glass-medium p-3 rounded-full hover:bg-glass-medium/80 transition-smooth z-10"
    >
      <ChevronLeft :size="24" />
    </button>
    <button
      v-if="items.length > 1"
      @click="next"
      class="absolute right-4 top-1/2 -translate-y-1/2 glass-medium p-3 rounded-full hover:bg-glass-medium/80 transition-smooth z-10"
    >
      <ChevronRight :size="24" />
    </button>

    <!-- Indicators -->
    <div v-if="items.length > 1" class="absolute bottom-8 left-1/2 -translate-x-1/2 flex gap-2 z-10">
      <button
        v-for="(_, index) in items"
        :key="index"
        @click="goTo(index)"
        :class="[
          'w-12 h-1 rounded-full transition-smooth',
          index === currentIndex ? 'bg-primary' : 'bg-white/30 hover:bg-white/50'
        ]"
      ></button>
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
</style>
