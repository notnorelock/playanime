<script setup lang="ts">
/**
 * Skeleton Hero Loader
 * Animated placeholder for hero carousel during loading
 */
</script>

<template>
  <div class="relative w-full h-[70vh] overflow-hidden rounded-2xl glass-light animate-pulse">
    <!-- Background gradient -->
    <div class="absolute inset-0 bg-gradient-to-r from-dark-900 via-dark-800 to-dark-900" />

    <!-- Content area -->
    <div class="absolute bottom-0 left-0 right-0 p-8 md:p-16">
      <div class="max-w-2xl space-y-6">
        <!-- Title -->
        <div class="space-y-3">
          <div class="h-12 bg-dark-800 rounded w-3/4" />
          <div class="h-12 bg-dark-800 rounded w-1/2" />
        </div>

        <!-- Metadata badges -->
        <div class="flex gap-3">
          <div class="h-8 bg-dark-800 rounded w-24" />
          <div class="h-8 bg-dark-800 rounded w-20" />
          <div class="h-8 bg-dark-800 rounded w-32" />
        </div>

        <!-- Description -->
        <div class="space-y-2">
          <div class="h-4 bg-dark-800 rounded w-full" />
          <div class="h-4 bg-dark-800 rounded w-5/6" />
          <div class="h-4 bg-dark-800 rounded w-4/6" />
        </div>

        <!-- Action buttons -->
        <div class="flex gap-4">
          <div class="h-12 bg-dark-800 rounded w-40" />
          <div class="h-12 bg-dark-800 rounded w-40" />
        </div>
      </div>
    </div>

    <!-- Navigation dots -->
    <div class="absolute bottom-8 right-8 flex gap-2">
      <div class="w-3 h-3 rounded-full bg-dark-800" />
      <div class="w-3 h-3 rounded-full bg-dark-800" />
      <div class="w-3 h-3 rounded-full bg-dark-800" />
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
