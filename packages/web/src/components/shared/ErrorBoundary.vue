<script setup lang="ts">
/**
 * Error Boundary Component
 * Catches and displays errors gracefully with fallback UI
 */

import { ref, onErrorCaptured } from 'vue'
import { useLocale } from '@/composables/useLocale'
import { AlertTriangle, RefreshCw, Home } from 'lucide-vue-next'
import { useRouter } from 'vue-router'

const { t } = useLocale()
const router = useRouter()

const error = ref<Error | null>(null)
const errorInfo = ref<string>('')

onErrorCaptured((err: Error, _instance, info) => {
  error.value = err
  errorInfo.value = info
  console.error('ErrorBoundary caught:', err, info)
  return false // Prevent error propagation
})

const reload = () => {
  error.value = null
  errorInfo.value = ''
  window.location.reload()
}

const goHome = () => {
  error.value = null
  errorInfo.value = ''
  router.push('/')
}
</script>

<template>
  <div v-if="error" class="min-h-screen flex items-center justify-center p-4">
    <div class="glass-medium rounded-2xl p-8 max-w-2xl w-full text-center">
      <div class="flex justify-center mb-6">
        <div class="w-20 h-20 rounded-full bg-primary/20 flex items-center justify-center">
          <AlertTriangle :size="40" class="text-primary" />
        </div>
      </div>

      <h1 class="text-3xl font-bold text-text-primary mb-4">
        {{ t('error.somethingWentWrong') }}
      </h1>

      <p class="text-text-secondary mb-6">
        {{ t('error.errorBoundaryMessage') }}
      </p>

      <!-- Error Details -->
      <div class="glass-light rounded-lg p-4 mb-6 text-left">
        <p class="text-sm text-text-muted mb-2">{{ t('error.technicalDetails') }}:</p>
        <pre class="text-xs text-text-secondary overflow-auto">{{ error.message }}</pre>
        <pre v-if="errorInfo" class="text-xs text-text-muted mt-2">{{ errorInfo }}</pre>
      </div>

      <!-- Action Buttons -->
      <div class="flex flex-col sm:flex-row gap-4 justify-center">
        <button
          @click="reload"
          class="flex items-center justify-center gap-2 px-6 py-3 bg-primary hover:bg-primary-hover text-white rounded-lg font-semibold transition-all"
        >
          <RefreshCw :size="20" />
          {{ t('error.reload') }}
        </button>

        <button
          @click="goHome"
          class="flex items-center justify-center gap-2 px-6 py-3 glass-light hover:glass-medium text-text-primary rounded-lg font-semibold transition-all"
        >
          <Home :size="20" />
          {{ t('error.goHome') }}
        </button>
      </div>
    </div>
  </div>

  <!-- Render children when no error -->
  <slot v-else />
</template>
