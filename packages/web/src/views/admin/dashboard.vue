<script setup lang="ts">
/**
 * Administration console.
 *
 * Two tiers, matching the API: moderators handle content, administrators also
 * manage accounts. The sections a moderator cannot use are not rendered — but
 * that is presentation. Every endpoint behind them is guarded server-side, and
 * the route guard refuses the page outright to anyone below moderator.
 */

import { computed, ref } from 'vue'
import { UserRole } from '@playanime/contracts'
import { useLocale } from '@/composables/useLocale'
import { useAuthStore } from '@/store/auth'
import { usePageTitle } from '@/composables/usePageTitle'
import { isAdmin, isModerator } from '@/utils/user'
import {
  LayoutDashboard,
  Film,
  Users,
  Globe,
  MessageSquare,
  BarChart3,
  ShieldCheck,
  ShieldAlert,
  FileEdit,
  Mail,
  Newspaper,
  Megaphone
} from 'lucide-vue-next'

import AdminOverview from '@/components/features/Admin/AdminOverview.vue'
import AdminAnnouncementManagement from '@/components/features/Admin/AdminAnnouncementManagement.vue'
import AdminAnimeManagement from '@/components/features/Admin/AdminAnimeManagement.vue'
import AdminUserManagement from '@/components/features/Admin/AdminUserManagement.vue'
import AdminTranslatorManagement from '@/components/features/Admin/AdminTranslatorManagement.vue'
import AdminCommentModeration from '@/components/features/Admin/AdminCommentModeration.vue'
import AdminAnalytics from '@/components/features/Admin/AdminAnalytics.vue'
import AdminSourceQueue from '@/components/features/Admin/AdminSourceQueue.vue'
import AdminCatalogueProposals from '@/components/features/Admin/AdminCatalogueProposals.vue'
import AdminTakedownQueue from '@/components/features/Admin/AdminTakedownQueue.vue'
import AdminContactInbox from '@/components/features/Admin/AdminContactInbox.vue'
import AdminBlogManagement from '@/components/features/Admin/AdminBlogManagement.vue'

definePage({
  meta: {
    requiresAuth: true,
    // Refused before the view mounts, rather than rendering a denial panel.
    requiresRole: UserRole.MODERATOR
  }
})

type SectionId =
  | 'overview'
  | 'queue'
  | 'proposals'
  | 'takedowns'
  | 'contact'
  | 'blog'
  | 'announcements'
  | 'anime'
  | 'users'
  | 'translators'
  | 'comments'
  | 'analytics'

const { t } = useLocale()
const authStore = useAuthStore()

usePageTitle(() => t('admin.dashboard.title'))

const activeSection = ref<SectionId>('overview')

const canModerate = computed(() => isModerator(authStore.user))
const canAdminister = computed(() => isAdmin(authStore.user))

/**
 * Sections available to the current user.
 *
 * User management is administrator-only, mirroring the API: a moderator who
 * cannot call those endpoints should not be shown a panel that only errors.
 */
const navItems = computed(() =>
  [
    { id: 'overview' as const, label: t('admin.dashboard.sections.overview'), icon: LayoutDashboard, visible: true },
    { id: 'queue' as const, label: t('moderation.queueTitle'), icon: ShieldCheck, visible: true },
    { id: 'proposals' as const, label: t('catalogue.proposalsQueueTitle'), icon: FileEdit, visible: true },
    { id: 'takedowns' as const, label: t('reports.queueTitle'), icon: ShieldAlert, visible: true },
    { id: 'contact' as const, label: t('admin.contact.title'), icon: Mail, visible: true },
    { id: 'blog' as const, label: t('admin.blog.title'), icon: Newspaper, visible: canAdminister.value },
    { id: 'announcements' as const, label: t('admin.announcements.title'), icon: Megaphone, visible: canAdminister.value },
    { id: 'anime' as const, label: t('admin.dashboard.sections.anime'), icon: Film, visible: true },
    { id: 'users' as const, label: t('admin.dashboard.sections.users'), icon: Users, visible: canAdminister.value },
    { id: 'translators' as const, label: t('admin.dashboard.sections.translators'), icon: Globe, visible: true },
    { id: 'comments' as const, label: t('admin.dashboard.sections.comments'), icon: MessageSquare, visible: true },
    { id: 'analytics' as const, label: t('admin.dashboard.sections.analytics'), icon: BarChart3, visible: true }
  ].filter((item) => item.visible)
)
</script>

<template>
  <div class="admin-dashboard min-h-screen bg-dark-900">
    <!--
      The route guard already refuses anyone below moderator, so this only
      covers the moment before the session resolves.
    -->
    <div v-if="!canModerate" class="container mx-auto px-4 py-12 text-center">
      <p class="text-text-secondary text-xl">{{ t('common.loading') }}</p>
    </div>

    <!-- Admin Dashboard Content -->
    <div v-else class="container mx-auto px-4 py-8 max-w-7xl">
      <!-- Header -->
      <div class="mb-8">
        <h1 class="text-4xl font-bold text-text-primary mb-2">
          {{ t('admin.dashboard.title') }}
        </h1>
        <p class="text-text-secondary">
          {{ t('admin.dashboard.subtitle') }}
        </p>
      </div>

      <div class="grid grid-cols-12 gap-6">
        <!-- Sidebar Navigation -->
        <aside class="col-span-12 lg:col-span-3">
          <nav class="glass-medium rounded-lg p-4 sticky top-4">
            <ul class="space-y-2">
              <li v-for="item in navItems" :key="item.id">
                <button
                  :class="[
                    'w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-smooth',
                    activeSection === item.id
                      ? 'bg-primary text-white'
                      : 'text-text-secondary hover:text-text-primary hover:bg-white/10'
                  ]"
                  @click="activeSection = item.id"
                >
                  <component :is="item.icon" :size="20" />
                  <span class="font-medium">{{ item.label }}</span>
                </button>
              </li>
            </ul>
          </nav>
        </aside>

        <!-- Main Content -->
        <main class="col-span-12 lg:col-span-9">
          <!-- Overview Section -->
          <AdminOverview v-if="activeSection === 'overview'" />

          <!-- Source moderation queue -->
          <AdminSourceQueue v-else-if="activeSection === 'queue'" />

          <!-- Cross-group catalogue edit proposals -->
          <AdminCatalogueProposals v-else-if="activeSection === 'proposals'" />

          <!-- Takedown / report review queue -->
          <AdminTakedownQueue v-else-if="activeSection === 'takedowns'" />

          <!-- Contact-form inbox -->
          <AdminContactInbox v-else-if="activeSection === 'contact'" />

          <!-- Blog — administrators only -->
          <AdminBlogManagement v-else-if="activeSection === 'blog' && canAdminister" />

          <!-- Homepage announcement — administrators only -->
          <AdminAnnouncementManagement v-else-if="activeSection === 'announcements' && canAdminister" />

          <!-- Anime Management -->
          <AdminAnimeManagement v-else-if="activeSection === 'anime'" />

          <!-- User Management — administrators only -->
          <AdminUserManagement v-else-if="activeSection === 'users' && canAdminister" />

          <!-- Translator Management -->
          <AdminTranslatorManagement v-else-if="activeSection === 'translators'" />

          <!-- Comment Moderation -->
          <AdminCommentModeration v-else-if="activeSection === 'comments'" />

          <!-- Analytics -->
          <AdminAnalytics v-else-if="activeSection === 'analytics'" />
        </main>
      </div>
    </div>
  </div>
</template>

<style scoped>
.admin-dashboard {
  @apply w-full;
}
</style>
