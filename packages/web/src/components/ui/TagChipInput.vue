<script setup lang="ts">
/**
 * Chip input for a free-form, create-on-demand list — genres and tags in
 * the authoring form. Selected values show as removable pills; typing
 * offers matching suggestions from `suggestions`, and pressing Enter (or
 * picking a suggestion) adds whatever's typed even when it matches
 * nothing already known, since the backend creates an unrecognized
 * genre/tag on demand rather than rejecting it.
 */

import { computed, ref } from 'vue'
import { X } from 'lucide-vue-next'

interface Props {
  modelValue: string[]
  suggestions?: readonly string[]
  placeholder?: string
  maxItems?: number
}

const props = withDefaults(defineProps<Props>(), {
  suggestions: () => [],
  placeholder: '',
  maxItems: undefined
})

const emit = defineEmits<{
  'update:modelValue': [value: string[]]
}>()

const draft = ref('')
const showSuggestions = ref(false)

const matchingSuggestions = computed(() => {
  const query = draft.value.trim().toLowerCase()
  if (query.length === 0) return []

  return props.suggestions
    .filter(
      (name) => name.toLowerCase().includes(query) && !props.modelValue.includes(name)
    )
    .slice(0, 8)
})

const atLimit = computed(
  () => props.maxItems !== undefined && props.modelValue.length >= props.maxItems
)

function add(name: string): void {
  const trimmed = name.trim()
  if (trimmed.length === 0 || props.modelValue.includes(trimmed) || atLimit.value) return

  emit('update:modelValue', [...props.modelValue, trimmed])
  draft.value = ''
  showSuggestions.value = false
}

function remove(name: string): void {
  emit('update:modelValue', props.modelValue.filter((value) => value !== name))
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter' || event.key === ',') {
    event.preventDefault()
    add(draft.value)
  } else if (event.key === 'Backspace' && draft.value.length === 0 && props.modelValue.length > 0) {
    const last = props.modelValue[props.modelValue.length - 1]
    if (last !== undefined) remove(last)
  }
}
</script>

<template>
  <div class="tag-chip-input">
    <div class="flex flex-wrap gap-2 mb-2" v-if="modelValue.length > 0">
      <span
        v-for="name in modelValue"
        :key="name"
        class="inline-flex items-center gap-1.5 pl-3 pr-1.5 py-1 rounded-md text-sm bg-primary/20 text-primary"
      >
        {{ name }}
        <button
          type="button"
          class="rounded-full p-0.5 hover:bg-primary/30 transition-smooth"
          :aria-label="`Remove ${name}`"
          @click="remove(name)"
        >
          <X :size="12" />
        </button>
      </span>
    </div>

    <div class="relative">
      <input
        v-model="draft"
        type="text"
        :placeholder="atLimit ? '' : placeholder"
        :disabled="atLimit"
        class="w-full px-3 py-2 rounded-lg text-sm text-white placeholder:text-white/50 bg-white/10 backdrop-blur-md border border-white/20 outline-none transition-smooth focus:border-primary focus:ring-2 focus:ring-primary/50 disabled:opacity-50 disabled:cursor-not-allowed"
        @keydown="handleKeydown"
        @focus="showSuggestions = true"
        @blur="showSuggestions = false"
      />

      <ul
        v-if="showSuggestions && matchingSuggestions.length > 0"
        class="absolute z-10 mt-1 w-full glass-strong rounded-lg overflow-hidden shadow-2xl max-h-48 overflow-y-auto"
      >
        <li v-for="name in matchingSuggestions" :key="name">
          <button
            type="button"
            class="w-full text-left px-3 py-2 text-sm text-text-secondary hover:bg-white/10 hover:text-text-primary transition-colors"
            @mousedown.prevent="add(name)"
          >
            {{ name }}
          </button>
        </li>
      </ul>
    </div>
  </div>
</template>
