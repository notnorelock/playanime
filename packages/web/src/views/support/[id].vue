<script setup lang="ts">
/**
 * One of the caller's own support tickets — the full thread, with a reply
 * box so the submitter can keep the conversation going, not just read
 * staff's replies. A reply reopens the ticket (see support.service.ts's
 * own doc comment); blocked once staff has closed it.
 */

import { onMounted, onUnmounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, LifeBuoy, Send } from 'lucide-vue-next'
import type { SupportTicketThreadDto } from '@playanime/contracts'
import { AbortError, ApiError, supportApi } from '@/api'
import { useApiError } from '@/composables/useApiError'
import { useLocale } from '@/composables/useLocale'
import { usePageTitle } from '@/composables/usePageTitle'
import { useToast } from '@/composables/useToast'
import Card from '@/components/ui/Card.vue'
import Button from '@/components/ui/Button.vue'
import Textarea from '@/components/ui/Textarea.vue'

definePage({
  meta: {
    requiresAuth: true
  }
})

const route = useRoute('/support/[id]')
const router = useRouter()
const { t, locale } = useLocale()
const { translateError } = useApiError()
const toast = useToast()

const thread = ref<SupportTicketThreadDto | null>(null)
const loading = ref(true)
const notFound = ref(false)
const error = ref<string | null>(null)

const replyText = ref('')
const submittingReply = ref(false)

usePageTitle(() => thread.value?.subject ?? t('support.title'))

let controller: AbortController | null = null

async function load(): Promise<void> {
  controller?.abort()
  const request = new AbortController()
  controller = request
  loading.value = true
  notFound.value = false
  error.value = null

  try {
    thread.value = await supportApi.mineThread(route.params.id, request.signal)
  } catch (cause: unknown) {
    if (AbortError.is(cause)) return
    if (ApiError.is(cause) && cause.status === 404) {
      notFound.value = true
    } else {
      error.value = translateError(cause)
    }
  } finally {
    if (controller === request) {
      loading.value = false
      controller = null
    }
  }
}

onMounted(load)
onUnmounted(() => controller?.abort())

function back(): void {
  router.push('/support')
}

async function sendReply(): Promise<void> {
  if (submittingReply.value || replyText.value.trim().length === 0) return
  submittingReply.value = true

  try {
    await supportApi.replyMine(route.params.id, replyText.value.trim())
    replyText.value = ''
    await load()
  } catch (cause: unknown) {
    toast.error(translateError(cause))
  } finally {
    submittingReply.value = false
  }
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(locale.value, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

function statusClass(status: SupportTicketThreadDto['status']): string {
  if (status === 'open') return 'bg-primary/20 text-primary'
  if (status === 'replied') return 'bg-accent-blue/20 text-accent-blue'
  return 'bg-white/10 text-text-muted'
}
</script>

<template>
  <div class="support-thread container mx-auto px-4 py-8 max-w-2xl">
    <Button variant="ghost" size="sm" class="mb-4" @click="back">
      <ArrowLeft :size="16" />
      {{ t('support.backToList') }}
    </Button>

    <div v-if="loading" class="space-y-4">
      <div class="h-8 bg-white/10 rounded w-2/3 animate-pulse"></div>
      <Card variant="glass" class="p-6 animate-pulse h-64" />
    </div>

    <Card v-else-if="notFound" variant="glass" class="p-12 text-center">
      <LifeBuoy :size="40" class="mx-auto mb-3 text-text-muted" />
      <p class="text-text-secondary">{{ t('support.notFound') }}</p>
    </Card>

    <Card v-else-if="error" variant="glass" class="p-8 text-center">
      <p class="text-text-secondary mb-4">{{ error }}</p>
      <Button variant="secondary" @click="load">{{ t('common.tryAgain') }}</Button>
    </Card>

    <template v-else-if="thread">
      <header class="mb-6 flex items-start justify-between gap-3">
        <div>
          <h1 class="text-2xl font-bold text-text-primary">{{ thread.subject }}</h1>
          <p class="text-sm text-text-muted mt-1">{{ t(`support.categories.${thread.category}`) }}</p>
        </div>
        <span class="shrink-0 px-2 py-0.5 rounded-full text-xs font-medium" :class="statusClass(thread.status)">
          {{ t(`support.statuses.${thread.status}`) }}
        </span>
      </header>

      <div class="space-y-3">
        <Card
          v-for="entry in thread.messages"
          :key="entry.id"
          variant="glass"
          class="p-4"
          :class="entry.direction === 'staff' ? 'border-l-2 border-primary/40' : 'border-l-2 border-white/20'"
        >
          <p class="text-xs text-text-muted mb-1">
            {{ entry.direction === 'staff' ? (entry.sentByUsername ?? t('support.staff')) : t('support.you') }}
            · {{ formatDate(entry.createdAt) }}
          </p>
          <p class="text-sm text-text-primary whitespace-pre-wrap">{{ entry.body }}</p>
        </Card>
      </div>

      <Card v-if="thread.status !== 'closed'" variant="glass" class="p-4 mt-4 space-y-3">
        <label class="block text-sm text-text-secondary">{{ t('support.replyLabel') }}</label>
        <Textarea v-model="replyText" :rows="3" :maxlength="5000" :placeholder="t('support.replyPlaceholder')" />
        <div class="flex justify-end">
          <Button
            variant="primary"
            size="sm"
            :disabled="submittingReply || replyText.trim().length === 0"
            @click="sendReply"
          >
            <Send :size="16" />
            {{ submittingReply ? t('common.saving') : t('support.sendReply') }}
          </Button>
        </div>
      </Card>
      <p v-else class="text-sm text-text-muted mt-4">{{ t('support.closedHint') }}</p>
    </template>
  </div>
</template>
