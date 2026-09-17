<script setup lang="ts">
/**
 * Sidebar Component
 * Fixed icon-only sidebar navigation with tooltips
 */

import { ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { Bell } from 'lucide-vue-next'
import { useLocale } from '@/composables/useLocale'
import { useNavigation } from '@/composables/useNavigation'
import { useNotifications } from '@/composables/useNotifications'
import { useAuthStore } from '@/store/auth'
import { directive as vTippy } from 'vue-tippy'
import AccountFlyout from '@/components/layout/AccountFlyout.vue'
import NotificationBell from '@/components/layout/NotificationBell.vue'
import 'tippy.js/dist/tippy.css'
import 'tippy.js/themes/translucent.css'

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()
const { t } = useLocale()
const { mainNavigationItems, sidebarBottomItem } = useNavigation()
const { unreadCount, hasUnread } = useNotifications()

const isFlyoutOpen = ref(false)
const bottomItemButton = ref<HTMLButtonElement | null>(null)
const flyoutAnchor = ref({ bottom: 0, left: 0 })

const isBellOpen = ref(false)
const bellButton = ref<HTMLButtonElement | null>(null)
const bellAnchor = ref({ bottom: 0, left: 0 })

function handleBellClick(): void {
  if (!isBellOpen.value && bellButton.value !== null) {
    const rect = bellButton.value.getBoundingClientRect()
    bellAnchor.value = { bottom: window.innerHeight - rect.bottom, left: rect.right + 16 }
  }
  isBellOpen.value = !isBellOpen.value
}

const isActive = (path: string) => {
  return route.path === path || route.path.startsWith(path + '/')
}

const navigateTo = (path: string) => {
  router.push(path)
}

/**
 * Signed in: open the account flyout. Anonymous: go straight to login.
 *
 * The flyout is teleported to `body` rather than nested inside this
 * `glass-strong` sidebar — backdrop-filter samples what is painted directly
 * behind an element, so a blurred panel nested inside an already-blurred
 * ancestor blurs the sidebar's own background instead of the page behind it,
 * which is why the panel looked unblurred against page content. Teleporting
 * it means it needs its own screen position, taken from the trigger button.
 */
const handleBottomItemClick = () => {
  if (authStore.isAuthenticated) {
    if (!isFlyoutOpen.value && bottomItemButton.value !== null) {
      const rect = bottomItemButton.value.getBoundingClientRect()
      // Anchored to the button's bottom edge, growing upward: this is the
      // last item in the sidebar, so a panel anchored to its top would
      // often overflow past the bottom of the viewport with taller content.
      flyoutAnchor.value = { bottom: window.innerHeight - rect.bottom, left: rect.right + 16 }
    }
    isFlyoutOpen.value = !isFlyoutOpen.value
  } else {
    navigateTo(sidebarBottomItem.value.path)
  }
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

      <!-- Notification bell -->
      <div v-if="authStore.isAuthenticated" class="relative w-full px-2 mb-2">
        <button
          ref="bellButton"
          v-tippy="{
            content: isBellOpen ? undefined : t('notifications.title'),
            placement: 'right',
            theme: 'translucent'
          }"
          class="relative w-12 h-12 mx-auto flex items-center justify-center rounded-lg transition-all duration-200"
          :class="
            isBellOpen
              ? 'bg-primary text-white'
              : 'text-text-secondary hover:text-primary hover:bg-glass-light'
          "
          @click="handleBellClick"
        >
          <Bell :size="20" />
          <span
            v-if="hasUnread"
            class="absolute top-1.5 right-1.5 min-w-4 h-4 px-1 rounded-full bg-primary text-white text-[10px] font-semibold flex items-center justify-center leading-none"
          >
            {{ unreadCount > 99 ? '99+' : unreadCount }}
          </span>
        </button>

        <NotificationBell
          :open="isBellOpen"
          :anchor="bellAnchor"
          :trigger-el="bellButton"
          @close="isBellOpen = false"
        />
      </div>

      <!-- Bottom Item - Account flyout or Login -->
      <div class="relative w-full px-2">
        <button
          ref="bottomItemButton"
          v-tippy="{
            content: isFlyoutOpen ? undefined : sidebarBottomItem.label,
            placement: 'right',
            theme: 'translucent'
          }"
          @click="handleBottomItemClick"
          :class="[
            'w-12 h-12 mx-auto flex items-center justify-center rounded-lg transition-all duration-200 overflow-hidden',
            isActive(sidebarBottomItem.path) || isFlyoutOpen
              ? 'bg-primary text-white'
              : 'text-text-secondary hover:text-primary hover:bg-glass-light'
          ]"
        >
          <img
            v-if="authStore.isAuthenticated && authStore.user?.avatar"
            :src="authStore.user.avatar"
            :alt="authStore.user.username"
            class="w-full h-full object-cover"
          />
          <component :is="sidebarBottomItem.icon" v-else :size="20" />
        </button>

        <AccountFlyout
          v-if="authStore.isAuthenticated"
          :open="isFlyoutOpen"
          :anchor="flyoutAnchor"
          :trigger-el="bottomItemButton"
          @close="isFlyoutOpen = false"
        />
      </div>
    </div>
  </aside>
</template>