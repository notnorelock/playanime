<script setup lang="ts">
/**
 * Watch Together — not yet available.
 *
 * The realtime contracts exist in `@playanime/contracts` (`PartyPlayback`, the
 * client/server event unions) and the database has `watch_parties`,
 * `watch_party_members` and `watch_party_messages`. What does not exist is a
 * WebSocket server: nothing in `@playanime/api` mounts one, so there is no
 * endpoint for a room to connect to.
 *
 * The room, chat and member components are kept under
 * `components/features/WatchTogether/` rather than deleted — they are the
 * intended UI and will be reconnected when the transport is built. This page
 * stands in so the route resolves and says plainly that the feature is off,
 * instead of rendering a browser that silently fails every request.
 *
 * To finish the feature: add an Elysia WebSocket route backed by Redis pub/sub
 * (so rooms work across API replicas), then restore this view from git history
 * and point it at the new endpoints.
 */

import { Users } from 'lucide-vue-next'
import { useLocale } from '@/composables/useLocale'
import { usePageTitle } from '@/composables/usePageTitle'
import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'

const { t } = useLocale()

usePageTitle(() => t('featureUnavailable.title'))
</script>

<template>
  <div class="container mx-auto px-4 py-16 max-w-2xl">
    <Card variant="glass" class="text-center py-12">
      <Users :size="48" class="mx-auto text-text-muted opacity-50 mb-4" />

      <h1 class="text-2xl font-bold text-text-primary mb-3">
        {{ t('featureUnavailable.title') }}
      </h1>

      <p class="text-text-secondary mb-8 max-w-md mx-auto">
        {{ t('featureUnavailable.description') }}
      </p>

      <Button variant="primary" @click="$router.push('/')">
        {{ t('featureUnavailable.backHome') }}
      </Button>
    </Card>
  </div>
</template>
