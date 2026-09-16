<script setup lang="ts">
/**
 * Load-more control.
 *
 * The catalogue is cursor-paginated, so there is no page count and no last
 * page to jump to — the server hands back an opaque cursor and whether more
 * rows exist. A numbered pager would have to invent that information, so the
 * control matches the contract instead of the other way round.
 */

import { Loader2 } from 'lucide-vue-next'
import Button from '@/components/ui/Button.vue'
import { useLocale } from '@/composables/useLocale'

const { t } = useLocale()

interface Props {
  hasMore: boolean
  loading?: boolean
  /** Rendered as context, e.g. "24 results". Omitted when unknown. */
  loadedCount?: number
}

withDefaults(defineProps<Props>(), {
  loading: false,
  loadedCount: undefined
})

const emit = defineEmits<{
  loadMore: []
}>()
</script>

<template>
  <div class="flex flex-col items-center gap-3 py-8">
    <p v-if="loadedCount !== undefined" class="text-sm text-text-muted">
      {{ loadedCount }} {{ t('common.results') }}
    </p>

    <Button
      v-if="hasMore"
      variant="glass"
      size="lg"
      :disabled="loading"
      @click="emit('loadMore')"
    >
      <Loader2 v-if="loading" :size="20" class="animate-spin" />
      {{ loading ? t('common.loading') : t('common.loadMore') }}
    </Button>
  </div>
</template>
