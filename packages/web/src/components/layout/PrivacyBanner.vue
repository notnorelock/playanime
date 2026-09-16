<script setup lang="ts">
import { computed } from 'vue'
import { useSettingsStore } from '@/store/settings'
import { useLocale } from '@/composables/useLocale'

const settingsStore = useSettingsStore()
const { t } = useLocale()

const isVisible = computed(() => !settingsStore.settings.privacyPolicyAccepted)

function acceptAll() {
  settingsStore.updateSetting('privacyPolicyAccepted', true)
}
</script>

<template>
  <Transition name="slide-up">
    <div
      v-if="isVisible"
      class="fixed bottom-0 left-0 right-0 z-50 bg-dark-800/95 backdrop-blur-lg border-t border-dark-700 shadow-2xl md:ml-16"
    >
      <div class="container mx-auto px-4 py-6 max-w-7xl">
        <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <!-- Content -->
          <div class="flex-1 space-y-2">
            <h3 class="text-lg font-semibold text-white flex items-center gap-2">
              <svg
                class="w-5 h-5 text-primary"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                />
              </svg>
              {{ t('privacy.banner.title') }}
            </h3>
            <p class="text-sm text-gray-300 leading-relaxed">
              {{ t('privacy.banner.description') }}
              <router-link
                to="/legal/privacy"
                class="text-primary hover:text-primary-light underline transition-colors"
              >
                {{ t('footer.privacy') }}
              </router-link>
              {{ t('privacy.banner.and') }}
              <router-link
                to="/legal/tos"
                class="text-primary hover:text-primary-light underline transition-colors"
              >
                {{ t('footer.terms') }}
              </router-link>.
            </p>
          </div>

          <!-- Actions -->
          <div class="flex flex-col sm:flex-row gap-3 md:shrink-0">
            <button
              type="button"
              class="px-6 py-2.5 bg-primary hover:bg-primary-light text-white font-medium rounded-lg transition-all duration-200 transform active:scale-95 shadow-lg hover:shadow-primary/50"
              @click="acceptAll"
            >
              {{ t('privacy.banner.acceptAll') }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.slide-up-enter-active,
.slide-up-leave-active {
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}

.slide-up-enter-from {
  transform: translateY(100%);
  opacity: 0;
}

.slide-up-leave-to {
  transform: translateY(100%);
  opacity: 0;
}

.slide-up-enter-to,
.slide-up-leave-from {
  transform: translateY(0);
  opacity: 1;
}
</style>
