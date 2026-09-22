<script setup lang="ts">
/**
 * Add-to-library control, shown on the anime detail page.
 *
 * This is the only place a title actually joins the viewer's library — watch
 * progress accrues automatically while playing an episode, but that is a
 * separate concept (`episode_progress`) from a status the viewer chose
 * (`library_entries`), and nothing elsewhere in the app writes the latter. A
 * title watched without ever clicking this still shows up in "Continue
 * Watching" but not under any status tab in the profile library.
 */

import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { BookmarkCheck, BookmarkPlus, ChevronDown } from 'lucide-vue-next'
import { WATCH_STATUSES, type WatchStatus } from '@playanime/contracts'
import { AbortError, libraryApi } from '@/api'
import { useApiError } from '@/composables/useApiError'
import { useLocale } from '@/composables/useLocale'
import { useToast } from '@/composables/useToast'
import { useAuthStore } from '@/store/auth'

interface Props {
  animeId: string
}

const props = defineProps<Props>()

const { t } = useLocale()
const { translateError } = useApiError()
const toast = useToast()
const authStore = useAuthStore()

const status = ref<WatchStatus | null>(null)
const loading = ref(true)
const saving = ref(false)
const isOpen = ref(false)

let controller: AbortController | null = null

const canUse = computed(() => authStore.isAuthenticated)

async function load(): Promise<void> {
  if (!canUse.value) {
    loading.value = false
    return
  }

  controller?.abort()
  const request = new AbortController()
  controller = request
  loading.value = true

  try {
    const entry = await libraryApi.status(props.animeId, request.signal)
    status.value = entry?.status ?? null
  } catch (cause: unknown) {
    if (AbortError.is(cause)) return
    status.value = null
  } finally {
    if (controller === request) {
      loading.value = false
      controller = null
    }
  }
}

onMounted(load)
watch(() => props.animeId, load)
onUnmounted(() => controller?.abort())

async function setStatus(next: WatchStatus): Promise<void> {
  if (!canUse.value) {
    toast.error(t('errors.unauthorized'))
    return
  }

  isOpen.value = false
  if (saving.value) return
  saving.value = true

  try {
    const entry = await libraryApi.save(props.animeId, { status: next })
    status.value = entry.status
  } catch (cause: unknown) {
    toast.error(translateError(cause))
  } finally {
    saving.value = false
  }
}

async function remove(): Promise<void> {
  isOpen.value = false
  if (saving.value) return
  saving.value = true

  try {
    await libraryApi.remove(props.animeId)
    status.value = null
  } catch (cause: unknown) {
    toast.error(translateError(cause))
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div v-if="!loading" class="relative" v-click-outside="() => (isOpen = false)">
    <button
      type="button"
      class="flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold transition-smooth w-full"
      :class="
        status !== null
          ? 'glass-medium text-text-primary hover:glass-strong'
          : 'glass-light text-text-secondary hover:glass-medium'
      "
      :disabled="saving"
      @click="isOpen = !isOpen"
    >
      <BookmarkCheck v-if="status !== null" :size="20" class="text-primary" />
      <BookmarkPlus v-else :size="20" />
      {{ status !== null ? t(`library.status.${status}`) : t('anime.addToList') }}
      <ChevronDown :size="16" :class="['transition-transform', { 'rotate-180': isOpen }]" />
    </button>

    <transition name="scale-fade">
      <div
        v-if="isOpen"
        class="absolute top-full left-0 right-0 mt-2 glass-strong rounded-lg p-1.5 shadow-2xl z-50"
      >
        <button
          v-for="option in WATCH_STATUSES"
          :key="option"
          type="button"
          class="w-full text-left px-3 py-2 rounded text-sm hover:bg-white/10 transition-colors"
          :class="{ 'bg-primary text-white': option === status }"
          @click="setStatus(option)"
        >
          {{ t(`library.status.${option}`) }}
        </button>

        <template v-if="status !== null">
          <div class="h-px bg-white/10 my-1" />
          <button
            type="button"
            class="w-full text-left px-3 py-2 rounded text-sm text-red-400 hover:bg-red-500/10 transition-colors"
            @click="remove"
          >
            {{ t('anime.removeFromList') }}
          </button>
        </template>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.scale-fade-enter-active,
.scale-fade-leave-active {
  transition: all 0.15s ease;
}

.scale-fade-enter-from,
.scale-fade-leave-to {
  opacity: 0;
  transform: scale(0.97);
}
</style>
