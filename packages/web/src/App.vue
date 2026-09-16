<script setup lang="ts">
import { RouterView } from 'vue-router'
import Sidebar from '@/components/layout/Sidebar.vue'
import BottomNavigation from '@/components/layout/BottomNavigation.vue'
import Footer from '@/components/layout/Footer.vue'
import PrivacyBanner from '@/components/layout/PrivacyBanner.vue'
import ErrorBoundary from '@/components/shared/ErrorBoundary.vue'
import ToastContainer from '@/components/ui/ToastContainer.vue'
</script>

<template>
  <div class="min-h-screen bg-dark-900 text-white">
    <Suspense>
      <!-- App default -->
      <template #default>
        <ErrorBoundary>
          <!-- Toast Notifications -->
          <ToastContainer />

          <!-- Sidebar (desktop only) -->
          <Sidebar />

          <!-- Bottom Navigation (mobile only) -->
          <BottomNavigation />

          <!-- Main Content Area - adjusted for sidebar on desktop, bottom nav on mobile -->
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
