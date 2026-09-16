<script setup lang="ts">
/**
 * Sidebar Component
 * Fixed icon-only sidebar navigation with tooltips
 */

import { useRouter, useRoute } from 'vue-router'
import { useNavigation } from '@/composables/useNavigation'
import { directive as vTippy } from 'vue-tippy'
import 'tippy.js/dist/tippy.css'
import 'tippy.js/themes/translucent.css'

const router = useRouter()
const route = useRoute()
const { mainNavigationItems, sidebarBottomItem } = useNavigation()

const isActive = (path: string) => {
  return route.path === path || route.path.startsWith(path + '/')
}

const navigateTo = (path: string) => {
  router.push(path)
}
</script>

<template>
  <aside
    class="hidden md:flex fixed left-0 top-0 h-screen w-16 glass-strong z-100"
  >
    <div class="flex flex-col items-center h-full w-full py-4">
      <!-- Logo at top -->
      <div class="mb-4">
        <img
          src="@/assets/images/playa-logo.svg"
          class="w-8 h-8 cursor-pointer"
          @click="navigateTo('/')"
        />
      </div>

      <!-- Navigation Items - Dynamically generated -->
      <nav class="flex-1 flex flex-col items-center justify-center space-y-2 w-full px-2">
        <button
          v-for="item in mainNavigationItems"
          :key="item.path"
          v-tippy="{
            content: item.label,
            placement: 'right',
            theme: 'translucent'
          }"
          @click="navigateTo(item.path)"
          :class="[
            'w-12 h-12 flex items-center justify-center rounded-lg transition-all duration-200',
            isActive(item.path)
              ? 'bg-primary text-white'
              : 'text-text-secondary hover:text-primary hover:bg-glass-light'
          ]"
        >
          <component :is="item.icon" :size="20" />
        </button>
      </nav>

      <!-- Bottom Item - Profile or Login -->
      <div class="w-full px-2">
        <button
          v-tippy="{
            content: sidebarBottomItem.label,
            placement: 'right',
            theme: 'translucent'
          }"
          @click="navigateTo(sidebarBottomItem.path)"
          :class="[
            'w-12 h-12 mx-auto flex items-center justify-center rounded-lg transition-all duration-200',
            isActive(sidebarBottomItem.path)
              ? 'bg-primary text-white'
              : 'text-text-secondary hover:text-primary hover:bg-glass-light'
          ]"
        >
          <component :is="sidebarBottomItem.icon" :size="20" />
        </button>
      </div>
    </div>
  </aside>
</template>

<style>
/* Tippy.js custom theme */
.tippy-box[data-theme~='translucent'] {
  background-color: rgba(255, 255, 255, 0.057);
  backdrop-filter: blur(12px);
  left: 6px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5);
}

.tippy-box[data-theme~='translucent'][data-placement^='right'] > .tippy-arrow::before {
  border-right-color: rgba(0, 0, 0, 0);
}

.tippy-box[data-theme~='translucent'] .tippy-content {
  padding: 8px 12px;
  font-size: 14px;
  font-weight: 500;
  color: #f3f4f6;
}
</style>
