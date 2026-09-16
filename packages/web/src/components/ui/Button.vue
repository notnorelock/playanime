<script setup lang="ts">
/**
 * Button Component
 * Professional glassmorphic button with variants
 */

import { computed } from 'vue'

interface Props {
  variant?: 'primary' | 'secondary' | 'ghost' | 'glass'
  size?: 'sm' | 'md' | 'lg'
  disabled?: boolean
  loading?: boolean
  block?: boolean
  icon?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  variant: 'primary',
  size: 'md',
  disabled: false,
  loading: false,
  block: false,
  icon: false
})

const buttonClasses = computed(() => {
  const classes = [
    'font-medium',
    'rounded-lg',
    'transition-smooth',
    'inline-flex',
    'items-center',
    'justify-center',
    'gap-2',
    'focus:outline-none',
    'focus:ring-2',
    'focus:ring-primary',
    'focus:ring-offset-2',
    'disabled:opacity-50',
    'disabled:cursor-not-allowed'
  ]

  // Variant classes
  if (props.variant === 'primary') {
    classes.push(
      'bg-primary',
      'text-white',
      'hover:bg-primary-hover',
      'shadow-md',
      'glow-primary-hover'
    )
  } else if (props.variant === 'secondary') {
    classes.push(
      'bg-dark-700',
      'text-text-primary',
      'hover:bg-dark-600',
      'border',
      'border-dark-500'
    )
  } else if (props.variant === 'ghost') {
    classes.push(
      'bg-transparent',
      'text-text-primary',
      'hover:bg-glass-light'
    )
  } else if (props.variant === 'glass') {
    classes.push(
      'glass-medium',
      'text-text-primary',
      'hover:glass-strong',
      'liquid-reflection'
    )
  }

  // Size classes
  if (props.size === 'sm') {
    classes.push(props.icon ? 'p-2' : 'px-3 py-1.5 text-sm')
  } else if (props.size === 'md') {
    classes.push(props.icon ? 'p-3' : 'px-4 py-2 text-base')
  } else if (props.size === 'lg') {
    classes.push(props.icon ? 'p-4' : 'px-6 py-3 text-lg')
  }

  // Block
  if (props.block) {
    classes.push('w-full')
  }

  return classes.join(' ')
})
</script>

<template>
  <button
    :class="buttonClasses"
    :disabled="disabled || loading"
    type="button"
  >
    <span v-if="loading" class="spinner w-4 h-4"></span>
    <slot v-else />
  </button>
</template>
