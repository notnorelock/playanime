<script setup lang="ts">
/**
 * SearchBar Component
 * Search input with icon
 */

import { Search } from 'lucide-vue-next'

interface Props {
  modelValue: string
  placeholder?: string
  size?: 'sm' | 'md' | 'lg'
}

const props = withDefaults(defineProps<Props>(), {
  placeholder: 'Search...',
  size: 'md'
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
  search: [value: string]
}>()

const handleInput = (e: Event) => {
  const target = e.target as HTMLInputElement
  emit('update:modelValue', target.value)
}

const handleKeyup = (e: KeyboardEvent) => {
  if (e.key === 'Enter') {
    emit('search', props.modelValue)
  }
}
</script>

<template>
  <div
    :class="[
      'flex items-center glass-light rounded-lg',
      size === 'sm' ? 'px-3 py-2' : size === 'lg' ? 'px-4 py-3' : 'px-4 py-2.5'
    ]"
  >
    <Search :size="size === 'sm' ? 18 : 20" class="text-white/50 mr-2 flex-shrink-0" />
    <input
      :value="modelValue"
      type="text"
      :placeholder="placeholder"
      :class="[
        'bg-transparent border-none outline-none text-white w-full',
        'placeholder:text-white/50',
        size === 'sm' ? 'text-sm' : size === 'lg' ? 'text-lg' : 'text-base'
      ]"
      @input="handleInput"
      @keyup="handleKeyup"
    />
  </div>
</template>
