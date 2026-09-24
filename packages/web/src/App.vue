<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { RouterView } from 'vue-router'
import Sidebar from '@/components/layout/Sidebar.vue'
import BottomNavigation from '@/components/layout/BottomNavigation.vue'
import Footer from '@/components/layout/Footer.vue'
import PrivacyBanner from '@/components/layout/PrivacyBanner.vue'
import EmailVerificationBanner from '@/components/layout/EmailVerificationBanner.vue'
import UpdatePrompt from '@/components/layout/UpdatePrompt.vue'
import AnnouncementBanner from '@/components/features/AnnouncementBanner.vue'
import ErrorBoundary from '@/components/shared/ErrorBoundary.vue'
import ToastContainer from '@/components/ui/ToastContainer.vue'
import { useAnnouncementBanner } from '@/composables/useAnnouncementBanner'

// Neither bar reserves space in <main> any more — both overlay content
// instead of pushing it down. `verificationBannerOffsetPx` below only
// stacks the two fixed bars vertically when both show at once (the
// announcement bar sits on top; the verification bar is pushed down by
// its height), so they don't render on top of each other.
const { announcement, dismissed: announcementDismissed, load: loadAnnouncement } = useAnnouncementBanner()

onMounted(loadAnnouncement)

const showsAnnouncementBanner = computed(() => announcement.value !== null && !announcementDismissed.value)

const BANNER_HEIGHT_PX = 44
const verificationBannerOffsetPx = computed(() => (showsAnnouncementBanner.value ? BANNER_HEIGHT_PX : 0))
</script>

<template>
  <div class="min-h-screen bg-dark-900 text-white">
    <Suspense>
      <!-- App default -->
      <template #default>
        <ErrorBoundary>
          <!-- Toast Notifications -->
          <ToastContainer />

          <!--
            Site-wide announcement strip — fixed top, above everything else
            (z-50, above the verification bar's z-40). The verification bar
            below is pushed down by verificationBannerOffsetPx when this one
            is also showing, so the two stack instead of overlapping.
          -->
          <AnnouncementBanner />

          <!-- Sidebar (desktop only) -->
          <Sidebar />

          <!-- Bottom Navigation (mobile only) -->
          <BottomNavigation />

          <!-- Email verification bar (fixed; overlays content, pushed down by verificationBannerOffsetPx when the announcement bar is also showing) -->
          <EmailVerificationBanner :style="{ top: `${verificationBannerOffsetPx}px` }" />

          <!-- Main Content Area - adjusted for sidebar on desktop, bottom nav on mobile. Fixed banners above overlay content rather than pushing it down. -->
          <main class="min-h-screen md:ml-16 pb-16 md:pb-0">
            <ErrorBoundary>
              <RouterView v-slot="{ Component, route }">

                <transition name="page" mode="out-in">
                  <component :is="Component" :key="route.path" />
                </transition>
              </RouterView>
            </ErrorBoundary>
          </main>

          <!-- Footer - adjusted for sidebar on desktop, bottom nav on mobile -->
          <div class="md:ml-16 mb-16 md:mb-0">
            <Footer />
          </div>

          <!-- Privacy Policy Banner -->
          <PrivacyBanner />

          <!-- New deploy available -->
          <UpdatePrompt />
        </ErrorBoundary>
      </template>

      <!-- Loading fallback -->
      <template #fallback>
        <div class="flex items-center justify-center min-h-[60vh]">
          <div class="text-center">
            <div class="w-12 h-12 border-3 border-primary/20 border-t-primary rounded-full animate-spin mx-auto mb-4">
            </div>
          </div>
        </div>
      </template>
    </Suspense>
  </div>
</template>

<style>
/* Instant page transitions - Crossfade only */
.page-enter-active,
.page-leave-active {
  transition: opacity 0.15s ease;
}

.page-enter-from {
  opacity: 0;
}

.page-leave-to {
  opacity: 0;
}

/* Spinner animation */
@keyframes spin {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
}

.animate-spin {
  animation: spin 1s linear infinite;
}
</style>
