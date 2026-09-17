<script setup lang="ts">
/**
 * Bottom Navigation Component
 * Mobile-first bottom navigation bar with primary navigation items
 */

import { ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { Bell } from 'lucide-vue-next'
import { useNavigation } from '@/composables/useNavigation'
import { useNotifications } from '@/composables/useNotifications'
import { useAuthStore } from '@/store/auth'
import { useLocale } from '@/composables/useLocale'
import NotificationBell from '@/components/layout/NotificationBell.vue'

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()
const { t } = useLocale()
const { primaryNavigationItems } = useNavigation()
const { unreadCount, hasUnread } = useNotifications()

const isActive = (path: string) => {
  return route.path === path || route.path.startsWith(path + '/')
}

const navigateTo = (path: string) => {
  router.push(path)
}

const isBellOpen = ref(false)
const bellButton = ref<HTMLButtonElement | null>(null)
const bellAnchor = ref({ bottom: 0, left: 0 })

function handleBellClick(): void {
  if (!isBellOpen.value && bellButton.value !== null) {
    const rect = bellButton.value.getBoundingClientRect()
    // Anchored from the top: this bar sits at the bottom of the screen, so
    // the panel grows upward from the button instead of off-screen below it.
    bellAnchor.value = { bottom: window.innerHeight - rect.top + 8, left: Math.max(8, rect.left - 200) }
  }
  isBellOpen.value = !isBellOpen.value
}
</script>

<template>
  <nav
    class="fixed bottom-0 left-0 right-0 z-50 glass-strong border-t border-white/10 md:hidden safe-area-bottom"
  >
    <div class="flex items-center justify-around h-16">
      <button
        v-for="item in primaryNavigationItems"
        :key="item.path"
        @click="navigateTo(item.path)"
        :class="[
          'flex flex-col items-center justify-center flex-1 h-full transition-all duration-200',
          isActive(item.path)
            ? 'text-primary'
            : 'text-text-secondary'
        ]"
      >
        <component
          :is="item.icon"
          :size="24"
          :class="[
            'mb-1 transition-transform duration-200',
            isActive(item.path) ? 'scale-110' : 'scale-100'
          ]"
        />
        <span
          :class="[
            'text-xs font-medium transition-all duration-200',
            isActive(item.path) ? 'opacity-100' : 'opacity-70'
          ]"
        >
          {{ item.label }}
        </span>
      </button>

      <button
        v-if="authStore.isAuthenticated"
        ref="bellButton"
        type="button"
        class="relative flex flex-col items-center justify-center flex-1 h-full transition-all duration-200"
        :class="isBellOpen ? 'text-primary' : 'text-text-secondary'"
        @click="handleBellClick"
      >
        <Bell :size="24" class="mb-1" />
        <span class="text-xs font-medium opacity-70">{{ t('notifications.title') }}</span>
        <span
          v-if="hasUnread"
          class="absolute top-1 right-[calc(50%-20px)] min-w-4 h-4 px-1 rounded-full bg-primary text-white text-[10px] font-semibold flex items-center justify-center leading-none"
        >
          {{ unreadCount > 99 ? '99+' : unreadCount }}
        </span>
      </button>

      <NotificationBell
        :open="isBellOpen"
        :anchor="bellAnchor"
        :trigger-el="bellButton"
        responsive-class="md:hidden"
        @close="isBellOpen = false"
      />
    </div>
  </nav>
</template>

<style scoped>
/* Safe area support for devices with notches */
.safe-area-bottom {
  padding-bottom: env(safe-area-inset-bottom);
}
</style>
