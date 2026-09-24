<script setup lang="ts">
/**
 * Who worked on this episode — "Grupa: ...", "Tłumaczenie: ...", shown
 * under the player. One block per crediting group (usually one, but two
 * groups can both have credited the same episode in different capacities);
 * a role line only appears when someone is actually credited in it.
 */

import { computed } from 'vue'
import { useLocale } from '@/composables/useLocale'
import { groupEpisodeCredits } from '@/models'
import type { EpisodeCreditDto } from '@playanime/contracts'
import Card from '@/components/ui/Card.vue'

interface Props {
  credits: EpisodeCreditDto[]
}

const props = defineProps<Props>()
const { t } = useLocale()

const groups = computed(() => groupEpisodeCredits(props.credits, t('sources.asStaff')))
</script>

<template>
  <Card v-if="groups.length > 0" variant="glass" class="p-4 space-y-4">
    <div v-for="group in groups" :key="group.groupId ?? 'staff'" class="space-y-1.5 text-sm">
      <div class="flex items-center gap-2">
        <span class="text-text-muted w-28 shrink-0">{{ t('catalogue.credits.group') }}:</span>
        <router-link
          v-if="group.groupSlug !== null"
          :to="{ name: '/translator/[slug]', params: { slug: group.groupSlug } }"
          class="text-primary hover:underline font-medium"
        >
          {{ group.groupName }}
        </router-link>
        <span v-else class="text-text-primary font-medium">{{ group.groupName }}</span>
      </div>

      <div v-for="entry in group.roles" :key="entry.role" class="flex items-start gap-2">
        <span class="text-text-muted w-28 shrink-0">{{ t(`catalogue.credits.role.${entry.role}`) }}:</span>
        <span class="text-text-secondary">{{ entry.names.join(', ') }}</span>
      </div>
    </div>
  </Card>
</template>
