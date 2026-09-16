<script setup lang="ts">
/**
 * Add a title to the catalogue.
 *
 * Open to staff and to editors of a translator group. A group's entry is
 * attributed to it, which is what makes direct creation safe to allow: a bad
 * entry is traceable to someone answerable for it, and a moderator can find
 * everything a group added in one query.
 */

import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { FilePlus } from 'lucide-vue-next'
import { useCataloguePermissions } from '@/composables/useCataloguePermissions'
import { useLocale } from '@/composables/useLocale'
import { usePageTitle } from '@/composables/usePageTitle'
import AnimeForm from '@/components/features/Catalogue/AnimeForm.vue'
import Card from '@/components/ui/Card.vue'

definePage({
  meta: {
    requiresAuth: true
  }
})

const route = useRoute()
const router = useRouter()
const { t } = useLocale()
const { permissions, load } = useCataloguePermissions()

/**
 * Arriving from a group's own page pre-selects that group, so a leader who
 * clicked "add a title" there does not have to find it again in a dropdown.
 */
const preferredGroupId = computed(() => {
  const value = route.query['groupId']
  return typeof value === 'string' && value.length > 0 ? value : null
})

usePageTitle(() => t('catalogue.createTitle'))

const ready = ref(false)

onMounted(async () => {
  await load()
  ready.value = true
})

function onSaved(slug: string): void {
  // Straight to the episode manager: a title with no episodes is not much use,
  // and adding them is almost always the next thing the author does.
  void router.push(`/catalogue/manage/${slug}`)
}
</script>

<template>
  <div class="catalogue-create container mx-auto px-4 py-8 max-w-4xl">
    <div class="flex items-center gap-3 mb-8">
      <FilePlus :size="28" class="text-primary" />
      <h1 class="text-3xl font-bold text-text-primary">{{ t('catalogue.createTitle') }}</h1>
    </div>

    <Card v-if="!ready" variant="glass" class="p-8 animate-pulse">
      <div class="h-4 bg-white/10 rounded w-1/3"></div>
    </Card>

    <!--
      A clear refusal rather than a form that fails on submit. The server is
      still the authority; this only avoids wasting the author's typing.
    -->
    <Card
      v-else-if="!permissions.canCreateAnime"
      variant="glass"
      class="p-8 text-center space-y-3"
    >
      <p class="text-text-primary font-medium">{{ t('catalogue.cannotCreate') }}</p>
      <p class="text-text-secondary text-sm">{{ t('catalogue.cannotCreateHint') }}</p>
      <router-link to="/translators" class="text-primary hover:underline inline-block">
        {{ t('translator.allTranslators') }}
      </router-link>
    </Card>

    <AnimeForm v-else :preferred-group-id="preferredGroupId" @saved="onSaved" />
  </div>
</template>
