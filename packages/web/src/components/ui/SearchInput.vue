<script setup lang="ts">
/**
 * Search Input Component
 * Reusable search input with icon
 */

import { Search as SearchIcon } from 'lucide-vue-next'

interface Props {
  modelValue: string
  placeholder?: string
  size?: 'sm' | 'md' | 'lg'
}

const props = withDefaults(defineProps<Props>(), {
  placeholder: 'Search...',
  size: 'lg'
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const sizeClasses = {
  sm: 'px-3 py-2 text-sm',
  md: 'px-4 py-2 text-base',
  lg: 'px-4 py-3 text-lg'
}

const iconSizes = {
  sm: 20,
  md: 22,
  lg: 24
}
</script>

<template>
  <div :class="['flex items-center glass-medium rounded-lg', sizeClasses[size]]">
    <SearchIcon :size="iconSizes[size]" class="text-text-muted mr-3" />
    <input
      :value="modelValue"
      @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
      type="text"
      :placeholder="placeholder"
      class="bg-transparent border-none outline-none text-text-primary w-full"
    />
  </div>
</template>
