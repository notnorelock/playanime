import type { Component } from 'vue'
import {
  Home,
  LayoutDashboard,
  TrendingUp,
  Languages,
  Newspaper,
  Crown,
  LifeBuoy,
  Search,
  User,
  LogIn,
  Settings
} from 'lucide-vue-next'

export interface RouteNavConfig {
  icon: Component
  label: string
  showInNav: boolean
  requiresAuth?: boolean
  guest?: boolean
  order: number
}

export const navigationConfig: Record<string, RouteNavConfig> = {
  '/': {
    icon: Home,
    label: 'nav.home',
    showInNav: true,
    order: 1
  },
  '/browse': {
    icon: LayoutDashboard,
    label: 'nav.browse',
    showInNav: true,
    order: 2
  },
  '/trending': {
    icon: TrendingUp,
    label: 'nav.trending',
    showInNav: true,
    order: 3
  },
  '/translators': {
    icon: Languages,
    label: 'nav.translators',
    showInNav: true,
    order: 4
  },
  '/blog': {
    icon: Newspaper,
    label: 'nav.blog',
    showInNav: true,
    order: 5
  },
  '/vip': {
    icon: Crown,
    label: 'nav.vip',
    showInNav: true,
    order: 6
  },
  '/search': {
    icon: Search,
    label: 'common.search',
    showInNav: true,
    order: 7
  },
  '/settings': {
    icon: Settings,
    label: 'nav.settings',
    showInNav: true,
    requiresAuth: false,
    order: 8
  },
  '/support': {
    icon: LifeBuoy,
    label: 'nav.support',
    showInNav: true,
    requiresAuth: true,
    order: 9
  },
  '/profile/me': {
    icon: User,
    label: 'nav.profile',
    showInNav: true,
    requiresAuth: true,
    order: 90
  },
  '/login': {
    icon: LogIn,
    label: 'auth.login',
    showInNav: false,
    guest: true,
    order: 99
  }
}
