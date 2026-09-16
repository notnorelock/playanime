import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useLocale } from '@/composables/useLocale'
import { useAuthStore } from '@/store/auth'
import type { Component } from 'vue'
import { User, LogIn } from 'lucide-vue-next'
import { navigationConfig } from '@/config/navigation'

export interface NavigationItem {
  icon: Component
  label: string
  path: string
  requiresAuth?: boolean
  order?: number
}

export function useNavigation() {
  const router = useRouter()
  const { t } = useLocale()
  const authStore = useAuthStore()

  const isAuthenticated = computed(() => authStore.isAuthenticated)
  const user = computed(() => authStore.user)

  const allRoutes = computed(() => {
    const routes = router.getRoutes()
    
    return routes
      .filter(route => {
        // Filter out routes with dynamic parameters (contain : or [])
        if (route.path.includes(':') || route.path.includes('[')) {
          return false
        }

        // Check if route has navigation config
        const navConfig = navigationConfig[route.path]
        if (!navConfig) {
          return false
        }

        // Only include routes that should show in nav
        if (!navConfig.showInNav) {
          return false
        }

        // Filter out guest-only routes if authenticated (e.g., login)
        if (isAuthenticated.value && navConfig.guest) {
          return false
        }

        // Filter out protected routes if not authenticated
        if (!isAuthenticated.value && navConfig.requiresAuth) {
          return false
        }

        return true
      })
      .map(route => {
        const navConfig = navigationConfig[route.path]!
        const path = route.path
        const labelKey = navConfig.label
        const label = path === '/profile/me' && user.value?.username 
          ? user.value.username 
          : t(labelKey)

        return {
          icon: navConfig.icon,
          label,
          path,
          requiresAuth: navConfig.requiresAuth || false,
          order: navConfig.order || 50
        } as NavigationItem
      })
      .sort((a, b) => (a.order || 50) - (b.order || 50))
  })

  // Main navigation items (for sidebar - items with order < 50)
  const mainNavigationItems = computed(() => {
    return allRoutes.value.filter(route => route.order! < 50)
  })

  // Bottom item for sidebar (profile or login - items with order >= 90)
  const sidebarBottomItem = computed(() => {
    const bottomRoute = allRoutes.value.find(r => r.order! >= 90)
    if (bottomRoute) {
      return bottomRoute
    }
    
    // Fallback to login button if no bottom route found
    return {
      icon: LogIn,
      label: t('auth.login'),
      path: '/login',
      requiresAuth: false,
      order: 99
    } as NavigationItem
  })

  // Primary navigation for mobile bottom nav (first 6 items + bottom item)
  const primaryNavigationItems = computed(() => {
    const mainItems = mainNavigationItems.value.slice(0, 6)
    const bottomRoute = allRoutes.value.find(r => r.order! >= 90)
    
    if (bottomRoute) {
      mainItems.push(bottomRoute)
    } else {
      mainItems.push({
        icon: LogIn,
        label: t('auth.login'),
        path: '/login',
        requiresAuth: false,
        order: 99
      })
    }

    return mainItems
  })

  return {
    allRoutes,
    mainNavigationItems,
    sidebarBottomItem,
    primaryNavigationItems,
    isAuthenticated,
    user
  }
}
