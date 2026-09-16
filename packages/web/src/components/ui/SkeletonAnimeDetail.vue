<script setup lang="ts">
/**
 * Skeleton Anime Detail Loader
 * Animated placeholder for anime detail page
 */
</script>

<template>
  <div class="skeleton-anime-detail animate-pulse">
    <!-- Hero Section -->
    <div class="relative w-full h-[60vh] mb-8">
      <!-- Background -->
      <div class="absolute inset-0 bg-dark-800" />

      <!-- Gradient Overlay -->
      <div class="absolute inset-0 bg-gradient-to-t from-dark-900 via-dark-900/60 to-transparent" />

      <!-- Content -->
      <div class="absolute bottom-0 left-0 right-0 p-8 md:p-16">
        <div class="container mx-auto">
          <div class="max-w-4xl">
            <!-- Title -->
            <div class="space-y-3 mb-6">
              <div class="h-10 bg-dark-800 rounded w-3/4" />
              <div class="h-10 bg-dark-800 rounded w-1/2" />
            </div>

            <!-- Metadata -->
            <div class="flex flex-wrap gap-4 mb-6">
              <div class="flex items-center gap-2">
                <div class="w-5 h-5 bg-dark-800 rounded" />
                <div class="h-5 bg-dark-800 rounded w-12" />
              </div>
              <div class="flex items-center gap-2">
                <div class="w-5 h-5 bg-dark-800 rounded" />
                <div class="h-5 bg-dark-800 rounded w-20" />
              </div>
              <div class="flex items-center gap-2">
                <div class="w-5 h-5 bg-dark-800 rounded" />
                <div class="h-5 bg-dark-800 rounded w-16" />
              </div>
              <div class="h-6 bg-dark-800 rounded w-24" />
            </div>

            <!-- Genres -->
            <div class="flex flex-wrap gap-2 mb-6">
              <div class="h-7 bg-dark-800 rounded w-20" />
              <div class="h-7 bg-dark-800 rounded w-24" />
              <div class="h-7 bg-dark-800 rounded w-16" />
            </div>

            <!-- Action Buttons -->
            <div class="flex gap-4">
              <div class="h-12 bg-dark-800 rounded w-40" />
              <div class="h-12 bg-dark-800 rounded w-40" />
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Main Content -->
    <div class="container mx-auto px-4 py-8">
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <!-- Left Column - Synopsis and Info -->
        <div class="lg:col-span-2 space-y-6">
          <!-- Synopsis -->
          <div>
            <div class="h-7 bg-dark-800 rounded w-32 mb-4" />
            <div class="space-y-3">
              <div class="h-4 bg-dark-800 rounded w-full" />
              <div class="h-4 bg-dark-800 rounded w-full" />
              <div class="h-4 bg-dark-800 rounded w-5/6" />
              <div class="h-4 bg-dark-800 rounded w-4/6" />
            </div>
          </div>

          <!-- Episodes Section -->
          <div>
            <div class="h-7 bg-dark-800 rounded w-40 mb-6" />
            <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              <div v-for="i in 8" :key="i" class="glass-light rounded-lg overflow-hidden">
                <div class="aspect-video bg-dark-800" />
                <div class="p-3 space-y-2">
                  <div class="h-4 bg-dark-800 rounded w-16" />
                  <div class="h-3 bg-dark-800 rounded w-full" />
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Right Column - Additional Info -->
        <div class="space-y-6">
          <!-- Info Card -->
          <div class="glass-light rounded-xl p-6 space-y-4">
            <div class="flex justify-between items-center">
              <div class="h-4 bg-dark-800 rounded w-24" />
              <div class="h-5 bg-dark-800 rounded w-16" />
            </div>
            <div class="flex justify-between items-center">
              <div class="h-4 bg-dark-800 rounded w-20" />
              <div class="h-5 bg-dark-800 rounded w-20" />
            </div>
            <div class="flex justify-between items-center">
              <div class="h-4 bg-dark-800 rounded w-28" />
              <div class="h-5 bg-dark-800 rounded w-24" />
            </div>
          </div>

          <!-- Translator Card -->
          <div class="glass-light rounded-xl p-6">
            <div class="h-5 bg-dark-800 rounded w-32 mb-4" />
            <div class="flex items-center gap-3 mb-3">
              <div class="w-12 h-12 rounded-full bg-dark-800" />
              <div class="flex-1">
                <div class="h-5 bg-dark-800 rounded w-32 mb-2" />
                <div class="h-3 bg-dark-800 rounded w-24" />
              </div>
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
