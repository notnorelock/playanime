<script setup lang="ts">
/**
 * Skeleton Translator Card Loader
 * Animated placeholder for translator cards
 */
</script>

<template>
  <div class="glass-light rounded-xl p-6 animate-pulse">
    <!-- Avatar and Name -->
    <div class="flex items-center gap-4 mb-6">
      <div class="w-16 h-16 rounded-full bg-dark-800" />
      <div class="flex-1">
        <div class="h-6 bg-dark-800 rounded w-32 mb-2" />
        <div class="h-4 bg-dark-800 rounded w-24" />
      </div>
    </div>

    <!-- Bio -->
    <div class="space-y-2 mb-6">
      <div class="h-3 bg-dark-800 rounded w-full" />
      <div class="h-3 bg-dark-800 rounded w-5/6" />
      <div class="h-3 bg-dark-800 rounded w-4/6" />
    </div>

    <!-- Stats -->
    <div class="grid grid-cols-3 gap-4">
      <div class="text-center">
        <div class="h-5 bg-dark-800 rounded w-12 mx-auto mb-2" />
        <div class="h-3 bg-dark-800 rounded w-16 mx-auto" />
      </div>
      <div class="text-center">
        <div class="h-5 bg-dark-800 rounded w-12 mx-auto mb-2" />
        <div class="h-3 bg-dark-800 rounded w-20 mx-auto" />
      </div>
      <div class="text-center">
        <div class="h-5 bg-dark-800 rounded w-12 mx-auto mb-2" />
        <div class="h-3 bg-dark-800 rounded w-12 mx-auto" />
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
