<script setup lang="ts">
import { onMounted, onBeforeUnmount } from 'vue'
import { useVersion } from '@/composables/useVersion'
import { useLocale } from '@/composables/useLocale'

const CHECK_INTERVAL_MS = 2 * 60 * 1000

const { updateAvailable, checkForUpdate } = useVersion()
const { t } = useLocale()

let checkTimer: ReturnType<typeof setInterval> | null = null

function onVisibilityChange(): void {
  if (document.visibilityState === 'visible') void checkForUpdate()
}

function refreshPage(): void {
  window.location.reload()
}

onMounted(() => {
  checkTimer = setInterval(() => void checkForUpdate(), CHECK_INTERVAL_MS)
  document.addEventListener('visibilitychange', onVisibilityChange)
})

onBeforeUnmount(() => {
  if (checkTimer) clearInterval(checkTimer)
  document.removeEventListener('visibilitychange', onVisibilityChange)
})
</script>

<template>
  <Transition name="slide-up">
    <aside
      v-if="updateAvailable"
      role="status"
      aria-live="polite"
      class="fixed bottom-20 right-4 z-50 flex w-[min(calc(100vw-2rem),24rem)] items-center gap-4 rounded-xl border border-white/10 glass-strong p-4 shadow-2xl md:bottom-4"
    >
      <div class="min-w-0 flex-1">
        <strong class="block text-sm font-semibold text-white">{{ t('update.prompt.title') }}</strong>
        <span class="block text-xs leading-relaxed text-gray-300">{{ t('update.prompt.description') }}</span>
      </div>
      <button
        type="button"
        class="shrink-0 rounded-lg bg-primary px-3.5 py-2 text-xs font-bold text-white transition-all duration-200 hover:bg-primary-light active:scale-95"
        @click="refreshPage"
      >
        {{ t('update.prompt.refresh') }}
      </button>
    </aside>
  </Transition>
</template>

<style scoped>
.slide-up-enter-active,
.slide-up-leave-active {
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}

.slide-up-enter-from,
.slide-up-leave-to {
  transform: translateY(1rem);
  opacity: 0;
}

.slide-up-enter-to,
.slide-up-leave-from {
  transform: translateY(0);
  opacity: 1;
}
</style>
