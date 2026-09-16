<script setup lang="ts">
import { useToast } from '@/composables/useToast'
import { CheckCircle, XCircle, AlertTriangle, Info, X } from 'lucide-vue-next'

const { toasts, removeToast } = useToast()

const getIcon = (type: string) => {
  switch (type) {
    case 'success':
      return CheckCircle
    case 'error':
      return XCircle
    case 'warning':
      return AlertTriangle
    case 'info':
      return Info
    default:
      return Info
  }
}

const getColorClasses = (type: string) => {
  switch (type) {
    case 'success':
      return 'bg-green-500/20 border-green-500/50 text-green-400'
    case 'error':
      return 'bg-red-500/20 border-red-500/50 text-red-400'
    case 'warning':
      return 'bg-yellow-500/20 border-yellow-500/50 text-yellow-400'
    case 'info':
      return 'bg-blue-500/20 border-blue-500/50 text-blue-400'
    default:
      return 'bg-gray-500/20 border-gray-500/50 text-gray-400'
  }
}

// Calculate offset for each toast based on its index
const getOffset = (index: number) => index * 12
</script>

<template>
  <div class="fixed top-4 right-4 z-[9999] pointer-events-none">
    <TransitionGroup name="toast">
      <div
        v-for="(toast, index) in toasts"
        :key="toast.id"
        :style="{ transform: `translateY(${getOffset(index)}px)` }"
        :class="[
          'pointer-events-auto mb-2 w-96 glass-strong border rounded-lg p-4 flex items-start gap-3 shadow-xl transition-all duration-300',
          getColorClasses(toast.type)
        ]"
      >
        <!-- Icon -->
        <component
          :is="getIcon(toast.type)"
          :size="20"
          class="flex-shrink-0 mt-0.5"
        />

        <!-- Message -->
        <p class="flex-1 text-sm font-medium text-text-primary">
          {{ toast.message }}
        </p>

        <!-- Close Button -->
        <button
          @click="removeToast(toast.id)"
          class="flex-shrink-0 text-text-muted hover:text-text-primary transition-colors"
        >
          <X :size="16" />
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
/* Toast enter/leave animations */
.toast-enter-active,
.toast-leave-active {
  transition: all 0.3s ease;
}

.toast-enter-from {
  opacity: 0;
  transform: translateX(100%) translateY(0);
}

.toast-leave-to {
  opacity: 0;
  transform: translateX(100%);
}

/* Move animation for toasts adjusting position */
.toast-move {
  transition: transform 0.3s ease;
}
</style>
