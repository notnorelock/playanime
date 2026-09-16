<script setup lang="ts">
/**
 * ProfileTabs
 *
 * Tabs are supplied by the parent rather than hardcoded: a public profile shows
 * activity only, while the viewer's own profile also shows their library. The
 * old fixed set included comments and ratings panels that were permanently
 * "coming soon".
 */

import { ref } from 'vue'
import { useLocale } from '@/composables/useLocale'

interface Props {
  /** Tab ids; each is rendered as `profile.tabs.<id>`. */
  tabs: readonly string[]
}

const props = defineProps<Props>()

const { t } = useLocale()

const activeTab = ref<string>(props.tabs[0] ?? '')

defineExpose({ activeTab })
</script>

<template>
  <div class="profile-tabs">
    <div v-if="tabs.length > 1" class="glass-medium rounded-lg p-1 inline-flex gap-1">
      <button
        v-for="tab in tabs"
        :key="tab"
        type="button"
        class="px-4 py-2 rounded-md text-sm font-medium transition-smooth"
        :class="[
          activeTab === tab
            ? 'bg-primary text-white'
            : 'text-text-secondary hover:text-text-primary hover:bg-white/10'
        ]"
        @click="activeTab = tab"
      >
        {{ t(`profile.tabs.${tab}`) }}
      </button>
    </div>

    <!-- Tab Content -->
    <div class="mt-6">
      <slot :active-tab="activeTab"></slot>
    </div>
  </div>
</template>

<style scoped>
.profile-tabs {
  @apply w-full;
}
</style>
