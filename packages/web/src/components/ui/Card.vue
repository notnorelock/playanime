<script setup lang="ts">
/**
 * Card Component
 * Glassmorphic card with hover effects
 */

import { computed } from 'vue'

interface Props {
  variant?: 'default' | 'glass' | 'flat'
  hover?: boolean
  padding?: 'none' | 'sm' | 'md' | 'lg'
}

const props = withDefaults(defineProps<Props>(), {
  variant: 'default',
  hover: true,
  padding: 'md'
})

const cardClasses = computed(() => {
  const classes = ['rounded-xl', 'transition-smooth', 'overflow-hidden']

  // Variant classes
  if (props.variant === 'default') {
    classes.push(
      'bg-dark-700',
      'border',
      'border-dark-600',
      'shadow-depth'
    )
  } else if (props.variant === 'glass') {
    classes.push(
      'glass-medium',
      'shadow-glass'
    )
  } else if (props.variant === 'flat') {
    classes.push(
      'bg-dark-800'
    )
  }

  // Hover effect
  if (props.hover) {
    classes.push(
      'hover:shadow-2xl',
      'liquid-reflection'
    )
  }

  // Padding
  if (props.padding === 'none') {
    classes.push('p-0')
  } else if (props.padding === 'sm') {
    classes.push('p-3')
  } else if (props.padding === 'md') {
    classes.push('p-4')
  } else if (props.padding === 'lg') {
    classes.push('p-6')
  }

  return classes.join(' ')
})
</script>

<template>
  <div :class="cardClasses">
    <slot />
  </div>
</template>
