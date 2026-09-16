<script setup lang="ts">
/**
 * Bottom Navigation Component
 * Mobile-first bottom navigation bar with primary navigation items
 */

import { useRouter, useRoute } from 'vue-router'
import { useNavigation } from '@/composables/useNavigation'

const router = useRouter()
const route = useRoute()
const { primaryNavigationItems } = useNavigation()

const isActive = (path: string) => {
  return route.path === path || route.path.startsWith(path + '/')
}

const navigateTo = (path: string) => {
  router.push(path)
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
    </div>
  </nav>
</template>

<style scoped>
/* Safe area support for devices with notches */
.safe-area-bottom {
  padding-bottom: env(safe-area-inset-bottom);
}
</style>
