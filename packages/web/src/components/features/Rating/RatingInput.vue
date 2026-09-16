<script setup lang="ts">
/**
 * RatingInput Component
 * Interactive 5-star rating input
 */

import { ref, computed } from 'vue'

interface Props {
  modelValue: number // 0-5 scale
  disabled?: boolean
  size?: 'sm' | 'md' | 'lg'
  readonly?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  disabled: false,
  size: 'md',
  readonly: false
})

const emit = defineEmits<{
  'update:modelValue': [value: number]
}>()

const hoveredRating = ref<number | null>(null)

const displayRating = computed(() => {
  return hoveredRating.value !== null ? hoveredRating.value : props.modelValue
})

const starSize = computed(() => {
  switch (props.size) {
    case 'sm':
      return 'w-5 h-5'
    case 'lg':
      return 'w-8 h-8'
    default:
      return 'w-6 h-6'
  }
})

const handleClick = (rating: number) => {
  if (props.disabled || props.readonly) return
  emit('update:modelValue', rating)
}

const handleMouseEnter = (rating: number) => {
  if (props.disabled || props.readonly) return
  hoveredRating.value = rating
}

const handleMouseLeave = () => {
  hoveredRating.value = null
}

const getStarFill = (starIndex: number): number => {
  const rating = displayRating.value
  if (rating >= starIndex) return 100
  if (rating > starIndex - 1) return (rating - (starIndex - 1)) * 100
  return 0
}
</script>

<template>
  <div
    class="rating-input inline-flex items-center gap-1"
    @mouseleave="handleMouseLeave"
  >
    <button
      v-for="i in 5"
      :key="i"
      type="button"
      class="relative transition-transform focus:outline-none focus:scale-110 disabled:cursor-not-allowed"
      :class="[
        starSize,
        { 'cursor-default': readonly, 'cursor-pointer': !disabled && !readonly }
      ]"
      :disabled="disabled"
      @click="handleClick(i)"
      @mouseenter="handleMouseEnter(i)"
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
        class="absolute inset-0 text-yellow-400 transition-all duration-200"
        fill="currentColor"
        viewBox="0 0 24 24"
        :style="{ clipPath: `inset(0 ${100 - getStarFill(i)}% 0 0)` }"
      >
        <path
          d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"
        />
      </svg>
    </button>

    <!-- Rating Value -->
    <span
      v-if="modelValue > 0"
      class="ml-2 text-sm font-medium text-text-primary"
    >
      {{ modelValue.toFixed(1) }}
    </span>
  </div>
</template>

<style scoped>
.rating-input {
  @apply select-none;
}
</style>
