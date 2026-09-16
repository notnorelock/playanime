<script setup lang="ts">
/**
 * Modal Component
 * Reusable modal with portal, overlay, and animations
 */

import { ref, onMounted, onUnmounted, watch } from 'vue'
import { Teleport } from 'vue'

interface Props {
  modelValue: boolean
  title?: string
  size?: 'sm' | 'md' | 'lg' | 'xl'
  closeOnOverlay?: boolean
  closeOnEsc?: boolean
  showClose?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  title: '',
  size: 'md',
  closeOnOverlay: true,
  closeOnEsc: true,
  showClose: true
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'close': []
}>()

const isOpen = ref(props.modelValue)

const sizeClasses = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl'
}

const close = () => {
  isOpen.value = false
  emit('update:modelValue', false)
  emit('close')
}

const handleOverlayClick = () => {
  if (props.closeOnOverlay) {
    close()
  }
}

const handleEscape = (e: KeyboardEvent) => {
  if (e.key === 'Escape' && props.closeOnEsc && isOpen.value) {
    close()
  }
}

const handleAfterLeave = () => {
  if (typeof document !== 'undefined' && document.body) {
    document.body.style.overflow = ''
  }
}

// Watch for external changes
watch(() => props.modelValue, (newValue) => {
  isOpen.value = newValue
  if (typeof document !== 'undefined' && document.body) {
    if (newValue) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
  }
})

onMounted(() => {
  if (typeof document !== 'undefined') {
    document.addEventListener('keydown', handleEscape)
    if (isOpen.value && document.body) {
      document.body.style.overflow = 'hidden'
    }
  }
})

onUnmounted(() => {
  if (typeof document !== 'undefined') {
    document.removeEventListener('keydown', handleEscape)
    if (document.body) {
      document.body.style.overflow = ''
    }
  }
})
</script>

<template>
  <Teleport to="body">
    <Transition
      name="modal"
      @after-leave="handleAfterLeave"
    >
      <div
        v-if="isOpen"
        class="modal-overlay fixed inset-0 z-50 flex items-center justify-center p-4"
        @click.self="handleOverlayClick"
      >
        <!-- Backdrop -->
        <div class="absolute inset-0 bg-black/70 backdrop-blur-sm"></div>

        <!-- Modal Content -->
        <div
          class="modal-content relative w-full glass-strong rounded-xl shadow-2xl overflow-hidden"
          :class="sizeClasses[size]"
          @click.stop
        >
          <!-- Header -->
          <div
            v-if="title || showClose || $slots.header"
            class="modal-header flex items-center justify-between px-6 py-4 border-b border-white/10"
          >
            <slot name="header">
              <h3 class="text-lg font-semibold text-text-primary">
                {{ title }}
              </h3>
            </slot>

            <button
              v-if="showClose"
              class="ml-4 p-2 rounded-lg hover:bg-white/10 transition-smooth text-text-secondary hover:text-text-primary focus:outline-none focus:ring-2 focus:ring-primary"
              @click="close"
            >
              <svg
                class="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          <!-- Body -->
          <div class="modal-body px-6 py-4">
            <slot></slot>
          </div>

          <!-- Footer -->
          <div
            v-if="$slots.footer"
            class="modal-footer px-6 py-4 border-t border-white/10"
          >
            <slot name="footer"></slot>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* Modal Animations */
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.3s ease;
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

.modal-enter-active .modal-content,
.modal-leave-active .modal-content {
  transition: transform 0.3s ease, opacity 0.3s ease;
}

.modal-enter-from .modal-content,
.modal-leave-to .modal-content {
  transform: scale(0.95) translateY(-20px);
  opacity: 0;
}

.modal-overlay {
  animation: fadeIn 0.3s ease;
}

@keyframes fadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
</style>
