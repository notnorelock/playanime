<script setup lang="ts">
/**
 * Custom Select Component
 * A dropdown select component built for dark theme with proper styling
 * Uses Teleport to render dropdown in body to avoid overflow issues
 */

import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import { ChevronDown } from 'lucide-vue-next'

export interface SelectOption {
  label: string
  value: any
}

interface Props {
  modelValue: any
  options: SelectOption[]
  placeholder?: string
  disabled?: boolean
  size?: 'sm' | 'md' | 'lg'
}

const props = withDefaults(defineProps<Props>(), {
  placeholder: 'Select an option',
  disabled: false,
  size: 'md'
})

const emit = defineEmits<{
  'update:modelValue': [value: any]
}>()

const isOpen = ref(false)
const selectRef = ref<HTMLDivElement>()
const buttonRef = ref<HTMLButtonElement>()
const dropdownStyle = ref({
  position: 'fixed' as const,
  top: '0px',
  left: '0px',
  width: '0px',
  zIndex: 9999
})

const selectedOption = computed(() => {
  return props.options.find(option => option.value === props.modelValue)
})

const displayValue = computed(() => {
  return selectedOption.value?.label || props.placeholder
})

const sizeClasses = computed(() => {
  switch (props.size) {
    case 'sm':
      return 'px-3 py-1.5 text-sm'
    case 'lg':
      return 'px-5 py-3 text-lg'
    default:
      return 'px-4 py-2.5'
  }
})

const updateDropdownPosition = () => {
  if (!buttonRef.value) return

  const rect = buttonRef.value.getBoundingClientRect()
  const viewportHeight = window.innerHeight
  const dropdownMaxHeight = 256 // max-h-64 = 16rem = 256px
  const spaceBelow = viewportHeight - rect.bottom
  const spaceAbove = rect.top

  // Decide whether to show dropdown above or below
  const showAbove = spaceBelow < dropdownMaxHeight && spaceAbove > spaceBelow

  dropdownStyle.value = {
    position: 'fixed',
    top: showAbove ? `${rect.top - dropdownMaxHeight - 8}px` : `${rect.bottom + 8}px`,
    left: `${rect.left}px`,
    width: `${rect.width}px`,
    zIndex: 9999,
    transformOrigin: showAbove ? 'bottom center' : 'top center'
  } as any
}

const toggleDropdown = () => {
  if (props.disabled) return

  if (!isOpen.value) {
    // Update position BEFORE opening to avoid transition from wrong position
    updateDropdownPosition()
    isOpen.value = true
    // Update again after nextTick to ensure accuracy
    nextTick(() => {
      updateDropdownPosition()
    })
  } else {
    isOpen.value = false
  }
}

const selectOption = (option: SelectOption) => {
  emit('update:modelValue', option.value)
  isOpen.value = false
}

const handleClickOutside = (event: MouseEvent) => {
  if (selectRef.value && !selectRef.value.contains(event.target as Node)) {
    isOpen.value = false
  }
}

const handleScroll = () => {
  if (isOpen.value) {
    updateDropdownPosition()
  }
}

const handleResize = () => {
  if (isOpen.value) {
    updateDropdownPosition()
  }
}

// Watch for open state changes to update position
watch(isOpen, (newValue) => {
  if (newValue) {
    window.addEventListener('scroll', handleScroll, true)
    window.addEventListener('resize', handleResize)
  } else {
    window.removeEventListener('scroll', handleScroll, true)
    window.removeEventListener('resize', handleResize)
  }
})

onMounted(() => {
  document.addEventListener('click', handleClickOutside)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', handleClickOutside)
  window.removeEventListener('scroll', handleScroll, true)
  window.removeEventListener('resize', handleResize)
})
</script>

<template>
  <div ref="selectRef" class="custom-select relative" :class="{ 'opacity-60 cursor-not-allowed': disabled }">
    <!-- Select Button -->
    <button
      ref="buttonRef"
      type="button"
      @click="toggleDropdown"
      :disabled="disabled"
      class="select-button w-full flex items-center justify-between gap-2 rounded-lg border transition-all duration-200"
      :class="[
        sizeClasses,
        isOpen
          ? 'border-primary/60 ring-2 ring-primary/20 bg-glass-light'
          : 'border-glass-medium bg-glass-light hover:bg-glass-medium hover:border-glass-strong',
        disabled ? 'cursor-not-allowed' : 'cursor-pointer'
      ]"
    >
      <span
        class="flex-1 text-left truncate"
        :class="selectedOption ? 'text-text-primary' : 'text-text-secondary'"
      >
        {{ displayValue }}
      </span>
      <ChevronDown
        :size="18"
        class="flex-shrink-0 text-text-secondary transition-transform duration-200"
        :class="{ 'rotate-180': isOpen }"
      />
    </button>

    <!-- Dropdown Menu (Teleported to body) -->
    <Teleport to="body">
      <Transition
        enter-active-class="transition-all duration-200 ease-out"
        enter-from-class="opacity-0 scale-95"
        enter-to-class="opacity-100 scale-100"
        leave-active-class="transition-all duration-150 ease-in"
        leave-from-class="opacity-100 scale-100"
        leave-to-class="opacity-0 scale-95"
      >
        <div
          v-if="isOpen"
          :style="dropdownStyle"
          class="dropdown-menu rounded-lg border border-glass-medium bg-surface-dark backdrop-blur-xl shadow-2xl overflow-hidden"
        >
          <div class="max-h-64 overflow-y-auto py-1">
            <button
              v-for="option in options"
              :key="option.value"
              type="button"
              @click="selectOption(option)"
              class="dropdown-option w-full px-4 py-2.5 text-left transition-colors duration-150"
              :class="[
                option.value === modelValue
                  ? 'bg-primary/25 text-text-primary font-medium'
                  : 'text-text-primary hover:bg-glass-medium'
              ]"
            >
              {{ option.label }}
            </button>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
@reference "@/styles/main.css";

.custom-select {
  font-family: inherit;
}

.select-button {
  background: rgba(255, 255, 255, 0.05);
}

.select-button:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.08);
}

.dropdown-menu {
  background: rgba(62, 62, 62, 0.98);
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.6);
}

.dropdown-option {
  position: relative;
}

.dropdown-option::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  background: transparent;
  transition: background 0.15s ease;
}

.dropdown-option:hover::before {
  background: var(--color-primary, #f69c5c);
}

/* Custom scrollbar for dropdown */
.dropdown-menu > div::-webkit-scrollbar {
  width: 6px;
}

.dropdown-menu > div::-webkit-scrollbar-track {
  background: rgba(255, 255, 255, 0.05);
  border-radius: 3px;
}

.dropdown-menu > div::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.2);
  border-radius: 3px;
}

.dropdown-menu > div::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.3);
}
</style>
