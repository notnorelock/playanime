<script setup lang="ts">
/**
 * Skeleton Card Loader
 * Animated placeholder for anime cards during loading
 */
</script>

<template>
  <div class="glass-light rounded-xl overflow-hidden animate-pulse">
    <!-- Image placeholder -->
    <div class="aspect-[2/3] bg-dark-800" />

    <!-- Content placeholder -->
    <div class="p-4">
      <!-- Title -->
      <div class="h-5 bg-dark-800 rounded mb-3 w-3/4" />

      <!-- Rating and info -->
      <div class="flex items-center gap-2 mb-2">
        <div class="h-4 bg-dark-800 rounded w-12" />
        <div class="h-4 bg-dark-800 rounded w-16" />
      </div>

      <!-- Description lines -->
      <div class="space-y-2">
        <div class="h-3 bg-dark-800 rounded w-full" />
        <div class="h-3 bg-dark-800 rounded w-5/6" />
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
