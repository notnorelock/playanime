<script setup lang="ts">
/**
 * Translator group directory.
 *
 * Groups are addressed by slug, and the listing is cursor-paginated like the
 * rest of the catalogue.
 */

import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Languages, Plus, Search } from 'lucide-vue-next'
import type { TranslatorGroupSummary } from '@playanime/contracts'
import { AbortError, translatorsApi } from '@/api'
import { useApiError } from '@/composables/useApiError'
import { useLocale } from '@/composables/useLocale'
import { usePageTitle } from '@/composables/usePageTitle'
import { useAuthStore } from '@/store/auth'
import TranslatorCard from '@/components/features/TranslatorCard.vue'
import SkeletonTranslatorCard from '@/components/ui/SkeletonTranslatorCard.vue'
import LoadMore from '@/components/shared/LoadMore.vue'
import Input from '@/components/ui/Input.vue'
import Select from '@/components/ui/Select.vue'
import Button from '@/components/ui/Button.vue'

definePage({
  meta: {
    icon: Languages,
    label: 'nav.translators',
    showInNav: true,
    order: 4
  }
})

const router = useRouter()
const { t } = useLocale()
const { translateError } = useApiError()
const authStore = useAuthStore()

usePageTitle(() => t('pageTitle.translators'))

const groups = ref<TranslatorGroupSummary[]>([])
const loading = ref(true)
const loadingMore = ref(false)
const hasMore = ref(false)
const error = ref<string | null>(null)

const searchQuery = ref('')
const filter = ref<'' | 'recruiting' | 'verified'>('')

let cursor: string | null = null
let controller: AbortController | null = null
let debounceTimer: ReturnType<typeof setTimeout> | null = null

const filterOptions = computed(() => [
  { label: t('common.all'), value: '' },
  { label: t('translator.recruiting'), value: 'recruiting' },
  { label: t('admin.dashboard.manage.translators.verified'), value: 'verified' }
])

async function load(append = false): Promise<void> {
  controller?.abort()
  const request = new AbortController()
  controller = request

  if (append) loadingMore.value = true
  else {
    loading.value = true
    cursor = null
  }
  error.value = null

  try {
    const page = await translatorsApi.list(
      {
        limit: 12,
        ...(searchQuery.value.trim().length > 0 ? { search: searchQuery.value.trim() } : {}),
        ...(filter.value === 'recruiting' ? { recruitingOnly: true } : {}),
        ...(filter.value === 'verified' ? { verifiedOnly: true } : {}),
        ...(append && cursor !== null ? { cursor } : {})
      },
      request.signal
    )

    if (request.signal.aborted) return

    groups.value = append ? [...groups.value, ...page.items] : page.items
    cursor = page.nextCursor
    hasMore.value = page.hasMore
  } catch (cause: unknown) {
    if (AbortError.is(cause)) return
    if (!append) groups.value = []
    error.value = translateError(cause)
  } finally {
    if (controller === request) {
      loading.value = false
      loadingMore.value = false
      controller = null
    }
  }
}

watch([searchQuery, filter], () => {
  if (debounceTimer !== null) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    void load()
  }, 300)
})

onMounted(() => {
  void load()
})

onUnmounted(() => {
  if (debounceTimer !== null) clearTimeout(debounceTimer)
  controller?.abort()
})

const openGroup = (slug: string) => {
  void router.push({ name: '/translator/[slug]', params: { slug } })
}
</script>

<template>
  <div class="translators container mx-auto px-4 py-8">
    <div class="flex flex-wrap items-start justify-between gap-4 mb-8">
      <div>
        <h1 class="text-4xl font-bold text-text-primary mb-2">
          {{ t('translator.allTranslators') }}
        </h1>
        <p class="text-text-secondary">{{ t('translator.description') }}</p>
      </div>

      <Button
        v-if="authStore.isAuthenticated"
        variant="primary"
        @click="router.push('/translator/create')"
      >
        <Plus :size="20" />
        {{ t('translator.createGroup') }}
      </Button>
    </div>

    <!-- Filters -->
    <div class="glass-medium rounded-2xl p-4 mb-8 flex flex-col md:flex-row gap-3">
      <div class="flex-1 relative">
        <Search :size="20" class="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
        <Input
          v-model="searchQuery"
          :placeholder="t('admin.dashboard.manage.translators.search')"
          class="pl-10 w-full"
        />
      </div>
      <Select v-model="filter" :options="filterOptions" />
    </div>

    <div v-if="error" class="mb-8 p-4 rounded-lg bg-red-500/20 border border-red-500/50 text-red-300">
      {{ error }}
    </div>

    <!-- Skeletons -->
    <div v-if="loading" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
      <SkeletonTranslatorCard v-for="i in 6" :key="`skeleton-${i}`" />
    </div>

    <template v-else>
      <div
        v-if="groups.length > 0"
        class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8"
      >
        <TranslatorCard
          v-for="group in groups"
          :key="group.id"
          :translator="group"
          @click="openGroup(group.slug)"
        />
      </div>

      <p v-else class="text-center text-text-secondary py-12">
        {{ t('translator.noGroups') }}
      </p>

      <LoadMore
        :has-more="hasMore"
        :loading="loadingMore"
        :loaded-count="groups.length"
        @load-more="load(true)"
      />
    </template>
  </div>
</template>
