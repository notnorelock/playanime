<script setup lang="ts">
/**
 * Input Component
 * Glassmorphic text input
 */

import { computed } from 'vue'

interface Props {
  modelValue: string
  type?: string
  placeholder?: string
  disabled?: boolean
  variant?: 'default' | 'glass' | 'outline'
  size?: 'sm' | 'md' | 'lg'
}

const props = withDefaults(defineProps<Props>(), {
  type: 'text',
  placeholder: '',
  disabled: false,
  variant: 'glass',
  size: 'md'
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const inputClasses = computed(() => {
  const classes = [
    'w-full',
    'outline-none',
    'transition-smooth',
    'text-white',
    'placeholder:text-white/50'
  ]

  // Variant classes
  if (props.variant === 'glass') {
    classes.push('bg-white/10', 'backdrop-blur-md', 'border', 'border-white/20')
  } else if (props.variant === 'outline') {
    classes.push('bg-transparent', 'border', 'border-white/30')
  } else {
    classes.push('bg-dark-700', 'border', 'border-dark-600')
  }

  // Size classes
  if (props.size === 'sm') {
    classes.push('px-3', 'py-1.5', 'text-sm', 'rounded-md')
  } else if (props.size === 'md') {
    classes.push('px-4', 'py-2', 'text-base', 'rounded-lg')
  } else if (props.size === 'lg') {
    classes.push('px-5', 'py-3', 'text-lg', 'rounded-lg')
  }

  // Disabled state
  if (props.disabled) {
    classes.push('opacity-50', 'cursor-not-allowed')
  } else {
    classes.push('focus:border-primary', 'focus:ring-2', 'focus:ring-primary/50')
  }

  return classes.join(' ')
})

const handleInput = (e: Event) => {
  const target = e.target as HTMLInputElement
  emit('update:modelValue', target.value)
}
</script>

<template>
  <input
    :type="type"
    :value="modelValue"
    :placeholder="placeholder"
    :disabled="disabled"
    :class="inputClasses"
    autocomplete="on"
    @input="handleInput"
  />
</template>
