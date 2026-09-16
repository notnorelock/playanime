<script setup lang="ts">
/**
 * Anime Grid Component
 * Reusable grid for displaying anime cards with skeleton loaders and carousel mode
 */

import { computed, ref, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { ChevronLeft, ChevronRight } from 'lucide-vue-next'
import { useLocale } from '@/composables/useLocale'
import AnimeCard from '@/components/shared/AnimeCard.vue'
import SkeletonCard from '@/components/ui/SkeletonCard.vue'
import type { AnimeCardModel } from '@/models'

const { t } = useLocale()

interface Props {
  animeList: AnimeCardModel[]
  title?: string
  viewAllLink?: string
  viewAllText?: string
  loading?: boolean
  carousel?: boolean
  watchProgressMap?: Map<string, { episodeId: string; positionSeconds: number; durationSeconds: number | null }>
  columns?: {
    default: number
    md: number
    lg: number
    xl: number
  }
}

const props = withDefaults(defineProps<Props>(), {
  loading: false,
  carousel: false,
  columns: () => ({
    default: 2,
    md: 3,
    lg: 5,
    xl: 6
  })
})

const scrollContainer = ref<HTMLElement | null>(null)
const showScrollButtons = ref(false)
const canScrollLeft = ref(false)
const canScrollRight = ref(false)

const gridClasses = computed(() => {
  if (props.carousel) {
    return 'flex gap-6 overflow-x-auto py-4 snap-x snap-mandatory scrollbar-hide scroll-smooth'
  }
  const { default: def, md, lg, xl } = props.columns
  return `grid grid-cols-${def} md:grid-cols-${md} lg:grid-cols-${lg} xl:grid-cols-${xl} gap-4`
})

const skeletonCount = computed(() => {
  return props.columns.lg || 6
})

const checkScroll = () => {
  if (!scrollContainer.value || !props.carousel) return

  const { scrollLeft, scrollWidth, clientWidth } = scrollContainer.value

  // Show buttons only if content overflows
  showScrollButtons.value = scrollWidth > clientWidth

  // Check if we can scroll in each direction
  canScrollLeft.value = scrollLeft > 0
  canScrollRight.value = scrollLeft < scrollWidth - clientWidth - 1
}

const scroll = (direction: 'left' | 'right') => {
  if (!scrollContainer.value) return
  const scrollAmount = scrollContainer.value.clientWidth * 0.8
  const newScrollLeft = direction === 'left'
    ? scrollContainer.value.scrollLeft - scrollAmount
    : scrollContainer.value.scrollLeft + scrollAmount
  scrollContainer.value.scrollTo({ left: newScrollLeft, behavior: 'smooth' })

  // Update button visibility after scroll
  setTimeout(checkScroll, 300)
}

// Watch for changes in anime list and loading state to re-check scroll
watch([() => props.animeList, () => props.loading], async () => {
  if (props.carousel && !props.loading) {
    await nextTick()
    checkScroll()
  }
})

onMounted(() => {
  if (props.carousel && scrollContainer.value) {
    checkScroll()
    scrollContainer.value.addEventListener('scroll', checkScroll)
    window.addEventListener('resize', checkScroll)
  }
})

onUnmounted(() => {
  if (scrollContainer.value) {
    scrollContainer.value.removeEventListener('scroll', checkScroll)
  }
  window.removeEventListener('resize', checkScroll)
})
</script>

<template>
  <section class="anime-grid relative">
    <div v-if="title" class="flex items-center justify-between mb-6">
      <h2 class="text-3xl font-bold text-text-primary">{{ title }}</h2>
      <router-link
        v-if="viewAllLink"
        :to="viewAllLink"
        class="text-primary hover:text-primary-hover transition-colors font-semibold"
      >
        {{ viewAllText || 'View All' }} →
      </router-link>
    </div>

    <!-- Carousel navigation arrows -->
    <button
      v-if="carousel && !loading && showScrollButtons && canScrollLeft"
      @click="scroll('left')"
      class="absolute left-0 top-1/2 -translate-y-1/2 z-10 glass-strong p-3 rounded-full hover:bg-primary transition-all opacity-90 hover:opacity-100 hidden md:block"
      :aria-label="t('common.scrollLeft')"
    >
      <ChevronLeft :size="24" />
    </button>
    <button
      v-if="carousel && !loading && showScrollButtons && canScrollRight"
      @click="scroll('right')"
      class="absolute right-0 top-1/2 -translate-y-1/2 z-10 glass-strong p-3 rounded-full hover:bg-primary transition-all opacity-90 hover:opacity-100 hidden md:block"
      :aria-label="t('common.scrollRight')"
    >
      <ChevronRight :size="24" />
    </button>

    <div ref="scrollContainer" :class="gridClasses">
      <template v-if="loading">
        <SkeletonCard
          v-for="i in skeletonCount"
          :key="`skeleton-${i}`"
          :class="{ 'flex-shrink-0 w-64 snap-start': carousel }"
        />
      </template>
      <template v-else>
        <AnimeCard
          v-for="anime in animeList"
          :key="anime.id"
          :anime="anime"
          :watch-progress="watchProgressMap?.get(anime.id)"
          :class="{ 'flex-shrink-0 w-64 snap-start transform-gpu': carousel }"
        />
      </template>
    </div>
  </section>
</template>

<style scoped>
.scrollbar-hide::-webkit-scrollbar {
  display: none;
}
.scrollbar-hide {
  -ms-overflow-style: none;
  scrollbar-width: none;
}
</style>
