<script setup lang="ts">
/**
 * Source selector.
 *
 * Lists exactly the sources the API returned for this episode, in the order it
 * ranked them. No provider is hardcoded here: a provider appears in this menu
 * only because a moderator approved a source for it, and its display name comes
 * from the source's own `displayHost`.
 */

import { computed, ref } from 'vue'
import { BadgeCheck, ChevronDown, Loader2, MonitorPlay } from 'lucide-vue-next'
import type { EpisodeSourceDto } from '@playanime/contracts'
import { useLocale } from '@/composables/useLocale'

interface Props {
  sources: readonly EpisodeSourceDto[]
  selectedSourceId: string | null
  loading?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  loading: false
})

const emit = defineEmits<{
  select: [sourceId: string]
}>()

const { t } = useLocale()
const isOpen = ref(false)

const selected = computed(
  () => props.sources.find((source) => source.id === props.selectedSourceId) ?? null
)

/**
 * Label for one source.
 *
 * Quality and language are submitter-supplied hints unless a moderator verified
 * them, so they are shown only when present — never defaulted to a plausible
 * value the provider never stated.
 */
function sourceLabel(source: EpisodeSourceDto): string {
  const parts = [source.displayHost]
  if (source.qualityHint !== null && source.qualityHint !== 'unknown') parts.push(source.qualityHint)
  if (source.audioLanguage !== null) parts.push(source.audioLanguage.toUpperCase())
  return parts.join(' · ')
}

function choose(sourceId: string): void {
  isOpen.value = false
  if (sourceId !== props.selectedSourceId) emit('select', sourceId)
}
</script>

<template>
  <div v-if="sources.length > 0" class="relative" v-click-outside="() => (isOpen = false)">
    <button
      type="button"
      class="flex items-center gap-2 glass-medium px-3 py-2 rounded-lg hover:glass-strong transition-smooth text-sm"
      :disabled="loading"
      @click="isOpen = !isOpen"
    >
      <Loader2 v-if="loading" :size="16" class="animate-spin text-primary" />
      <MonitorPlay v-else :size="16" class="text-primary" />

      <span class="text-text-muted">{{ t('player.source') }}:</span>
      <span class="text-text-primary font-medium">
        {{ selected ? sourceLabel(selected) : t('player.loadingSource') }}
      </span>

      <BadgeCheck v-if="selected?.isVerified" :size="14" class="text-accent-cyan" />
      <ChevronDown :size="16" :class="['transition-transform', { 'rotate-180': isOpen }]" />
    </button>

    <transition name="scale-fade">
      <div
        v-if="isOpen"
        class="absolute top-full left-0 mt-2 min-w-64 glass-strong rounded-lg p-1.5 shadow-2xl z-50 max-h-80 overflow-y-auto"
      >
        <button
          v-for="source in sources"
          :key="source.id"
          type="button"
          class="w-full text-left px-3 py-2 rounded text-sm hover:bg-white/10 transition-colors flex items-center justify-between gap-3"
          :class="{ 'bg-primary text-white': source.id === selectedSourceId }"
          @click="choose(source.id)"
        >
          <span class="flex items-center gap-2">
            {{ sourceLabel(source) }}
            <BadgeCheck v-if="source.isVerified" :size="14" class="text-accent-cyan" :title="t('player.verified')" />
          </span>

          <!-- Availability is tracked server-side by the health worker. -->
          <span
            v-if="source.availability === 'unavailable'"
            class="text-xs text-yellow-400 shrink-0"
          >
            {{ t('player.sourceUnavailable') }}
          </span>
          <span v-else-if="!source.canEmbed" class="text-xs text-text-muted shrink-0">
            {{ t('player.openExternally') }}
          </span>
        </button>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.scale-fade-enter-active,
.scale-fade-leave-active {
  transition: all 0.2s ease;
}

.scale-fade-enter-from,
.scale-fade-leave-to {
  opacity: 0;
  transform: scale(0.95);
}
</style>
