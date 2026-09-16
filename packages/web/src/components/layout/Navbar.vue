<script setup lang="ts">
/**
 * Navbar Component
 * Glassmorphic navigation with sticky header
 */

import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useLocale } from '@/composables/useLocale'
import { useAuthStore } from '@/store/auth'
import { Search, Menu, X, User, LogIn, UserPlus, LogOut } from 'lucide-vue-next'
import Button from '@/components/ui/Button.vue'

const router = useRouter()
const { t } = useLocale()
const authStore = useAuthStore()

const isAuthenticated = computed(() => authStore.isAuthenticated)
const user = computed(() => authStore.user)

const isScrolled = ref(false)
const isMobileMenuOpen = ref(false)
const searchQuery = ref('')

const handleScroll = () => {
  isScrolled.value = window.scrollY > 20
}

const toggleMobileMenu = () => {
  isMobileMenuOpen.value = !isMobileMenuOpen.value
}

const handleSearch = () => {
  if (searchQuery.value.trim()) {
    router.push({ name: '/search', query: { q: searchQuery.value } })
    searchQuery.value = ''
  }
}

const navigateTo = (routeName: string) => {
  // Navigated by path rather than by name: the generated route names are a
  // literal union, which a template string cannot satisfy.
  void router.push(`/${routeName}`)
  isMobileMenuOpen.value = false
}

const handleLogout = () => {
  authStore.logout()
  isMobileMenuOpen.value = false
  router.push({ name: '/' })
}

onMounted(() => {
  window.addEventListener('scroll', handleScroll)
})

onUnmounted(() => {
  window.removeEventListener('scroll', handleScroll)
})
</script>

<template>
  <nav
    :class="[
      'fixed top-0 left-0 right-0 z-50 transition-all duration-300',
      isScrolled ? 'glass-strong py-3' : 'bg-transparent py-4'
    ]"
  >
    <div class="container mx-auto px-6">
      <div class="flex items-center justify-end w-full">
        <!-- Search & Actions - Right aligned -->
        <div class="flex items-center gap-3">
          <!-- Search Bar (Desktop) -->
          <div class="hidden lg:flex items-center glass-light rounded-lg px-3 py-2 min-w-[300px]">
            <Search :size="20" class="text-text-muted mr-2" />
            <input
              v-model="searchQuery"
              type="text"
              :placeholder="t('common.search')"
              class="bg-transparent border-none outline-none text-text-primary w-full"
              @keyup.enter="handleSearch"
            />
          </div>

          <!-- Auth Buttons (Desktop) -->
          <div v-if="!isAuthenticated" class="hidden md:flex items-center gap-2">
            <Button variant="ghost" size="sm" @click="navigateTo('login')">
              <LogIn :size="18" class="mr-2" />
              {{ t('auth.login') }}
            </Button>
            <Button variant="primary" size="sm" @click="navigateTo('register')">
              <UserPlus :size="18" class="mr-2" />
              {{ t('auth.register') }}
            </Button>
          </div>

          <!-- User Menu (Desktop) -->
          <div v-else class="hidden md:flex items-center gap-2">
            <Button variant="ghost" size="sm" @click="navigateTo('profile')">
              <User :size="18" class="mr-2" />
              {{ user?.username }}
            </Button>
            <Button variant="ghost" size="sm" icon @click="handleLogout">
              <LogOut :size="18" />
            </Button>
          </div>

          <!-- Mobile Menu Toggle -->
          <Button
            variant="ghost"
            size="sm"
            icon
            @click="toggleMobileMenu"
            class="md:hidden"
          >
            <Menu v-if="!isMobileMenuOpen" :size="24" />
            <X v-else :size="24" />
          </Button>
        </div>
      </div>

      <!-- Mobile Search -->
      <div v-if="isMobileMenuOpen" class="lg:hidden mt-4">
        <div class="flex items-center glass-light rounded-lg px-3 py-2">
          <Search :size="20" class="text-text-muted mr-2" />
          <input
            v-model="searchQuery"
            type="text"
            :placeholder="t('common.search')"
            class="bg-transparent border-none outline-none text-text-primary w-full"
            @keyup.enter="handleSearch"
          />
        </div>
      </div>
    </div>

    <!-- Mobile Menu -->
    <transition
      enter-active-class="transition-opacity duration-200"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition-opacity duration-200"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="isMobileMenuOpen"
        class="md:hidden glass-strong mt-4 rounded-lg overflow-hidden"
      >
        <div class="flex flex-col">
          <button
            @click="navigateTo('home')"
            class="px-4 py-3 text-left text-text-secondary hover:text-primary hover:bg-glass-light transition-colors"
          >
            {{ t('nav.home') }}
          </button>
          <button
            @click="navigateTo('browse')"
            class="px-4 py-3 text-left text-text-secondary hover:text-primary hover:bg-glass-light transition-colors"
          >
            {{ t('nav.browse') }}
          </button>

          <!-- Mobile Auth Buttons -->
          <div class="border-t border-glass-light"></div>
          <template v-if="!isAuthenticated">
            <button
              @click="navigateTo('login')"
              class="px-4 py-3 text-left text-text-secondary hover:text-primary hover:bg-glass-light transition-colors flex items-center gap-2"
            >
              <LogIn :size="20" />
              <span>{{ t('auth.login') }}</span>
            </button>
            <button
              @click="navigateTo('register')"
              class="px-4 py-3 text-left text-primary hover:bg-glass-light transition-colors flex items-center gap-2 font-semibold"
            >
              <UserPlus :size="20" />
              <span>{{ t('auth.register') }}</span>
            </button>
          </template>
          <template v-else>
            <button
              @click="navigateTo('profile')"
              class="px-4 py-3 text-left text-text-secondary hover:text-primary hover:bg-glass-light transition-colors flex items-center gap-2"
            >
              <User :size="20" />
              <span>{{ user?.username }}</span>
            </button>
            <button
              @click="handleLogout"
              class="px-4 py-3 text-left text-red-400 hover:bg-glass-light transition-colors flex items-center gap-2"
            >
              <LogOut :size="20" />
              <span>{{ t('auth.logout') }}</span>
            </button>
          </template>
        </div>
      </div>
    </transition>
  </nav>
</template>
