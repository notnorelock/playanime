<script setup lang="ts">
/**
 * Translator credits for a title.
 *
 * Two related but distinct things, both worth showing: which group(s) have
 * claimed the title and are actively translating it (`groups`, from
 * `GET /translators/for-anime/:id`), and which group or user originally added
 * the entry (`createdByGroupId` on the anime itself). They usually coincide —
 * creating a title auto-claims it for the creating group — but a claim can be
 * added, removed or reassigned afterwards while the original creator stays
 * fixed, so neither one substitutes for the other.
 */

import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { BadgeCheck, Users } from 'lucide-vue-next'
import type { AnimeTranslatorCredit } from '@playanime/contracts'
import { AbortError, translatorsApi } from '@/api'
import { useLocale } from '@/composables/useLocale'

interface Props {
  animeId: string
  /** From the anime detail response; null when the title was added by a user directly, not on a group's behalf. */
  createdByGroupId: string | null
}

const props = defineProps<Props>()

const { t } = useLocale()

const groups = ref<AnimeTranslatorCredit[]>([])
const loading = ref(true)

let controller: AbortController | null = null

async function load(): Promise<void> {
  controller?.abort()
  const request = new AbortController()
  controller = request
  loading.value = true

  try {
    groups.value = await translatorsApi.forAnime(props.animeId, request.signal)
  } catch (cause: unknown) {
    if (AbortError.is(cause)) return
    groups.value = []
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

/** The creating group, when it's still among the credited groups — the common case. */
const creator = computed(
  () => groups.value.find((group) => group.id === props.createdByGroupId) ?? null
)

/** Everyone credited, aside from whichever one is already called out as the creator above. */
const otherGroups = computed(() =>
  groups.value.filter((group) => group.id !== props.createdByGroupId)
)

/** Nothing to show at all — no claims, and the title wasn't added on a group's behalf. */
const hasNothing = computed(
  () => !loading.value && groups.value.length === 0 && props.createdByGroupId === null
)
</script>

<template>
  <div v-if="!hasNothing" class="translator-credits">
    <div v-if="loading" class="flex gap-2">
      <div class="h-8 w-32 rounded-lg bg-white/10 animate-pulse" />
    </div>

    <div v-else class="flex flex-wrap items-center gap-2 text-sm">
      <span v-if="creator" class="text-text-muted">{{ t('anime.addedBy') }}</span>

      <router-link
        v-if="creator"
        :to="`/translator/${creator.slug}`"
        class="flex items-center gap-1.5 px-2.5 py-1 rounded-lg glass-light hover:glass-medium transition-smooth"
      >
        <img
          v-if="creator.avatar"
          :src="creator.avatar.url"
          :alt="creator.name"
          class="w-5 h-5 rounded-full object-cover"
        />
        <Users v-else :size="14" class="text-text-muted" />
        <span class="text-text-primary font-medium">{{ creator.name }}</span>
        <BadgeCheck v-if="creator.isVerified" :size="14" class="text-accent-cyan" />
      </router-link>

      <template v-if="otherGroups.length > 0">
        <span class="text-text-muted">
          {{ creator ? t('anime.alsoTranslatedBy') : t('anime.translatedBy') }}
        </span>

        <router-link
          v-for="group in otherGroups"
          :key="group.id"
          :to="`/translator/${group.slug}`"
          class="flex items-center gap-1.5 px-2.5 py-1 rounded-lg glass-light hover:glass-medium transition-smooth"
        >
          <img
            v-if="group.avatar"
            :src="group.avatar.url"
            :alt="group.name"
            class="w-5 h-5 rounded-full object-cover"
          />
          <Users v-else :size="14" class="text-text-muted" />
          <span class="text-text-primary font-medium">{{ group.name }}</span>
          <BadgeCheck v-if="group.isVerified" :size="14" class="text-accent-cyan" />
          <span v-if="group.episodeRange" class="text-text-muted text-xs">
            ({{ group.episodeRange }})
          </span>
        </router-link>
      </template>
    </div>
  </div>
</template>
