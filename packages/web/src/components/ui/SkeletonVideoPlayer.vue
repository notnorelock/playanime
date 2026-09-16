<script setup lang="ts">
/**
 * Skeleton Video Player Loader
 * Animated placeholder for video player page
 */
</script>

<template>
  <div class="skeleton-video-player animate-pulse">
    <!-- Video Player Section -->
    <div class="relative w-full bg-dark-900 mb-6">
      <!-- Video Player Placeholder -->
      <div class="aspect-video bg-dark-800 relative">
        <!-- Play Button -->
        <div class="absolute inset-0 flex items-center justify-center">
          <div class="w-20 h-20 rounded-full bg-dark-700" />
        </div>

        <!-- Controls Bar -->
        <div class="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-dark-900">
          <div class="space-y-3">
            <!-- Progress Bar -->
            <div class="h-1 bg-dark-700 rounded-full" />

            <!-- Controls -->
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-3">
                <div class="w-8 h-8 bg-dark-700 rounded" />
                <div class="w-8 h-8 bg-dark-700 rounded" />
                <div class="h-5 bg-dark-700 rounded w-24" />
              </div>

              <div class="flex items-center gap-3">
                <div class="w-8 h-8 bg-dark-700 rounded" />
                <div class="w-8 h-8 bg-dark-700 rounded" />
                <div class="w-8 h-8 bg-dark-700 rounded" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="container mx-auto px-4 py-6">
      <!-- Episode Info -->
      <div class="glass-light rounded-xl p-6 mb-6">
        <div class="flex items-start justify-between mb-4">
          <div class="flex-1">
            <div class="h-8 bg-dark-800 rounded w-3/4 mb-3" />
            <div class="h-5 bg-dark-800 rounded w-48 mb-4" />
            <div class="flex items-center gap-4">
              <div class="flex items-center gap-2">
                <div class="w-5 h-5 bg-dark-800 rounded" />
                <div class="h-4 bg-dark-800 rounded w-16" />
              </div>
              <div class="flex items-center gap-2">
                <div class="w-5 h-5 bg-dark-800 rounded" />
                <div class="h-4 bg-dark-800 rounded w-20" />
              </div>
            </div>
          </div>
        </div>

        <!-- Episode Description -->
        <div class="space-y-2 mb-4">
          <div class="h-4 bg-dark-800 rounded w-full" />
          <div class="h-4 bg-dark-800 rounded w-5/6" />
          <div class="h-4 bg-dark-800 rounded w-4/6" />
        </div>
      </div>

      <!-- Navigation Buttons -->
      <div class="flex gap-4 mb-8">
        <div class="h-12 bg-dark-800 rounded flex-1 max-w-xs" />
        <div class="h-12 bg-dark-800 rounded flex-1 max-w-xs" />
      </div>

      <!-- Translator Notes -->
      <div class="glass-light rounded-xl p-6 mb-8">
        <div class="h-6 bg-dark-800 rounded w-48 mb-4" />
        <div class="space-y-2">
          <div class="h-4 bg-dark-800 rounded w-full" />
          <div class="h-4 bg-dark-800 rounded w-4/5" />
        </div>
      </div>

      <!-- Episode List -->
      <div>
        <div class="h-7 bg-dark-800 rounded w-40 mb-6" />
        <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
          <div v-for="i in 12" :key="i" class="glass-light rounded-lg overflow-hidden">
            <div class="aspect-video bg-dark-800" />
            <div class="p-3 space-y-2">
              <div class="h-4 bg-dark-800 rounded w-16" />
              <div class="h-3 bg-dark-800 rounded w-full" />
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.animate-pulse {
  animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}
</style>
