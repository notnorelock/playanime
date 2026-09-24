<script setup lang="ts">
/**
 * Site-wide announcement strip, fixed to the top of every page — styled to
 * match `EmailVerificationBanner.vue` (tinted background, border-bottom,
 * backdrop-blur) rather than a solid block, and overlays content the same
 * way that bar does, instead of pushing it down. See
 * `useAnnouncementBanner` for the shared visibility state.
 */

import { onMounted } from 'vue'
import { Megaphone, X } from 'lucide-vue-next'
import { useAnnouncementBanner } from '@/composables/useAnnouncementBanner'
import { useLocale } from '@/composables/useLocale'

const { t } = useLocale()
const { announcement, dismissed, load, dismiss } = useAnnouncementBanner()

onMounted(load)
</script>

<template>
  <div
    v-if="announcement && !dismissed"
    class="fixed top-0 left-0 right-0 z-50 bg-primary/10 border-b border-primary/40 backdrop-blur-lg md:ml-16"
  >
    <div class="container mx-auto px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap">
      <div class="flex items-center gap-2 min-w-0">
        <Megaphone :size="16" class="text-primary shrink-0" />
        <p class="text-sm text-text-primary truncate">
          {{ announcement.message }}
        </p>
      </div>

      <div class="flex items-center gap-3 shrink-0">
        <a
          v-if="announcement.linkUrl"
          :href="announcement.linkUrl"
          class="text-sm font-medium text-primary hover:text-primary-hover transition-smooth"
        >
          {{ announcement.linkLabel ?? t('common.viewAll') }}
        </a>
        <button
          type="button"
          class="p-1 text-primary/80 hover:text-primary transition-smooth"
          :aria-label="t('common.dismiss')"
          @click="dismiss"
        >
          <X :size="16" />
        </button>
      </div>
    </div>
  </div>
</template>
