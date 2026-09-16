<script setup lang="ts">
/**
 * RatingDisplay Component
 * Read-only star rating display with average and count
 */

import { computed } from 'vue'

interface Props {
  rating: number // 0-5 scale
  count?: number
  size?: 'sm' | 'md' | 'lg'
  showValue?: boolean
  showCount?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  count: 0,
  size: 'md',
  showValue: true,
  showCount: true
})

const starSize = computed(() => {
  switch (props.size) {
    case 'sm':
      return 'w-4 h-4'
    case 'lg':
      return 'w-7 h-7'
    default:
      return 'w-5 h-5'
  }
})

const textSize = computed(() => {
  switch (props.size) {
    case 'sm':
      return 'text-xs'
    case 'lg':
      return 'text-base'
    default:
      return 'text-sm'
  }
})

const getStarFill = (starIndex: number): number => {
  if (props.rating >= starIndex) return 100
  if (props.rating > starIndex - 1) return (props.rating - (starIndex - 1)) * 100
  return 0
}

const formattedCount = computed(() => {
  if (props.count === 0) return 'No ratings'
  if (props.count === 1) return '1 rating'
  if (props.count >= 1000) return `${(props.count / 1000).toFixed(1)}k ratings`
  return `${props.count} ratings`
})
</script>

<template>
  <div class="rating-display inline-flex items-center gap-2">
    <!-- Stars -->
    <div class="inline-flex items-center gap-0.5">
      <div
        v-for="i in 5"
        :key="i"
        class="relative"
        :class="starSize"
      >
        <!-- Star Background (Empty) -->
        <svg
          class="absolute inset-0 text-white/20"
          fill="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"
          />
        </svg>

        <!-- Star Foreground (Filled) -->
        <svg
          class="absolute inset-0 text-yellow-400"
          fill="currentColor"
          viewBox="0 0 24 24"
          :style="{ clipPath: `inset(0 ${100 - getStarFill(i)}% 0 0)` }"
        >
          <path
            d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"
          />
        </svg>
      </div>
    </div>

    <!-- Rating Value -->
    <span
      v-if="showValue"
      class="font-semibold text-text-primary"
      :class="textSize"
    >
      {{ rating > 0 ? rating.toFixed(1) : '—' }}
    </span>

    <!-- Rating Count -->
    <span
      v-if="showCount && count > 0"
      class="text-text-secondary"
      :class="textSize"
    >
      ({{ formattedCount }})
    </span>
  </div>
</template>

<style scoped>
.rating-display {
  @apply select-none;
}
</style>
