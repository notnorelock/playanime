<script setup lang="ts">
/**
 * Skeleton Grid Loader
 * Grid layout of skeleton cards
 */

import SkeletonCard from './SkeletonCard.vue'

interface Props {
  count?: number
  columns?: {
    default?: number
    md?: number
    lg?: number
    xl?: number
  }
}

const props = withDefaults(defineProps<Props>(), {
  count: 6,
  columns: () => ({ default: 2, md: 3, lg: 4, xl: 6 })
})

const gridClasses = `
  grid gap-6
  grid-cols-${props.columns.default || 2}
  md:grid-cols-${props.columns.md || 3}
  lg:grid-cols-${props.columns.lg || 4}
  xl:grid-cols-${props.columns.xl || 6}
`
</script>

<template>
  <div :class="gridClasses">
    <SkeletonCard v-for="i in count" :key="i" />
  </div>
</template>
