<script setup lang="ts">
/**
 * Translator Card
 * Directory card for a fansub group.
 *
 * The previous version showed a view count. The catalogue does not track views
 * per group and the API exposes none, so the tile now shows the two figures it
 * actually maintains — members and claimed titles — rather than a fabricated
 * number.
 */

import { ref } from 'vue'
import { useLocale } from '@/composables/useLocale'
import { BadgeCheck, Film, Users } from 'lucide-vue-next'
import Card from '@/components/ui/Card.vue'
import type { TranslatorGroupSummary } from '@playanime/contracts'

interface Props {
  translator: TranslatorGroupSummary
}

defineProps<Props>()

const emit = defineEmits<{
  click: []
}>()

const { t } = useLocale()
const imageLoaded = ref(false)
const imageError = ref(false)
</script>

<template>
  <Card variant="glass" @click="emit('click')" class="group cursor-pointer">
    <div class="flex items-start gap-4">
      <!-- Avatar -->
      <div class="relative w-20 h-20 rounded-lg overflow-hidden shrink-0 bg-dark-800">
        <div
          v-if="translator.avatar && !imageLoaded && !imageError"
          class="absolute inset-0 bg-dark-800 animate-pulse"
        />

        <img
          v-if="translator.avatar && !imageError"
          :src="translator.avatar.url"
          :alt="translator.name"
          :class="[
            'w-full h-full object-cover transition-opacity duration-300',
            { 'opacity-0': !imageLoaded, 'opacity-100': imageLoaded }
          ]"
          loading="lazy"
          @load="imageLoaded = true"
          @error="imageError = true"
        />

        <div v-else class="absolute inset-0 flex items-center justify-center">
          <Users :size="32" class="text-text-muted opacity-50" />
        </div>
      </div>

      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2 mb-2 flex-wrap">
          <h3 class="text-xl font-bold text-text-primary group-hover:text-primary transition-colors truncate">
            {{ translator.name }}
          </h3>

          <BadgeCheck
            v-if="translator.isVerified"
            :size="16"
            class="text-accent-cyan shrink-0"
            :title="t('admin.dashboard.manage.translators.verified')"
          />

          <span
            v-if="translator.isRecruiting"
            class="px-2 py-0.5 rounded-full text-xs bg-primary/20 text-primary shrink-0"
          >
            {{ t('translator.recruiting') }}
          </span>
        </div>

        <p v-if="translator.description" class="text-text-secondary text-sm line-clamp-2">
          {{ translator.description }}
        </p>
      </div>
    </div>

    <div class="grid grid-cols-2 gap-4 mt-4 pt-4 border-t border-glass-light">
      <div class="text-center">
        <div class="flex items-center justify-center gap-1 text-primary mb-1">
          <Users :size="16" />
          <span class="font-semibold">{{ translator.memberCount }}</span>
        </div>
        <div class="text-xs text-text-muted">{{ t('translator.members') }}</div>
      </div>
      <div class="text-center">
        <div class="flex items-center justify-center gap-1 text-accent-cyan mb-1">
          <Film :size="16" />
          <span class="font-semibold">{{ translator.entryCount }}</span>
        </div>
        <div class="text-xs text-text-muted">{{ t('common.anime') }}</div>
      </div>
    </div>
  </Card>
</template>

<style scoped>
.line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
