<template>
  <div class="relative w-full bg-dark-900 aspect-video overflow-hidden">
    <!-- Skeleton Video Area -->
    <div class="absolute inset-0 bg-dark-800 animate-pulse" />

    <!-- Skeleton Controls -->
    <div class="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/80 to-transparent">
      <!-- Progress Bar Skeleton -->
      <div class="h-1.5 mb-3 bg-dark-700 rounded-full animate-pulse" />

      <!-- Controls Skeleton -->
      <div class="flex items-center justify-between">
        <!-- Left Controls -->
        <div class="flex items-center gap-2">
          <div class="w-10 h-10 bg-dark-700 rounded-lg animate-pulse" />
          <div class="w-8 h-8 bg-dark-700 rounded-lg animate-pulse" />
          <div class="w-8 h-8 bg-dark-700 rounded-lg animate-pulse" />
          <div class="w-8 h-8 bg-dark-700 rounded-lg animate-pulse" />
          <div class="w-24 h-4 bg-dark-700 rounded animate-pulse ml-2" />
        </div>

        <!-- Right Controls -->
        <div class="flex items-center gap-2">
          <div class="w-8 h-8 bg-dark-700 rounded-lg animate-pulse" />
          <div class="w-8 h-8 bg-dark-700 rounded-lg animate-pulse" />
        </div>
      </div>
    </div>

    <!-- Center Play Button Skeleton -->
    <div class="absolute inset-0 flex items-center justify-center">
      <div class="w-20 h-20 bg-dark-700 rounded-full animate-pulse" />
    </div>
  </div>
</template>

<script setup lang="ts">
// Skeleton loader for VideoPlayer
</script>
