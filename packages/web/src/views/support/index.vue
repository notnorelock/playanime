<script setup lang="ts">
/**
 * "My tickets" — a logged-in user's own support requests: a submission
 * form plus their existing tickets, newest first. Replies happen on the
 * thread view (`/support/[id]`), not here.
 */

import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { LifeBuoy, Send } from 'lucide-vue-next'
import { SUPPORT_TICKET_CATEGORIES, type SupportTicketCategory, type SupportTicketDto } from '@playanime/contracts'
import { AbortError, supportApi } from '@/api'
import { useApiError } from '@/composables/useApiError'
import { useLocale } from '@/composables/useLocale'
import { usePageTitle } from '@/composables/usePageTitle'
import { useToast } from '@/composables/useToast'
import Card from '@/components/ui/Card.vue'
import Input from '@/components/ui/Input.vue'
import Textarea from '@/components/ui/Textarea.vue'
import Select from '@/components/ui/Select.vue'
import Button from '@/components/ui/Button.vue'

definePage({
  meta: {
    requiresAuth: true
  }
})

const router = useRouter()
const { t } = useLocale()
const { translateError } = useApiError()
const toast = useToast()

usePageTitle(() => t('support.title'))

const category = ref<SupportTicketCategory>('general')
const subject = ref('')
const message = ref('')
const submitting = ref(false)

const categoryOptions = computed(() =>
  SUPPORT_TICKET_CATEGORIES.map((value) => ({ label: t(`support.categories.${value}`), value }))
)

async function submit(): Promise<void> {
  if (submitting.value || subject.value.trim().length === 0 || message.value.trim().length === 0) return
  submitting.value = true

  try {
    await supportApi.submit({
      category: category.value,
      subject: subject.value.trim(),
      message: message.value.trim()
    })
    subject.value = ''
    message.value = ''
    toast.success(t('support.submitted'))
    await load(true)
  } catch (cause: unknown) {
    toast.error(translateError(cause))
  } finally {
    submitting.value = false
  }
}

/* -------------------------------------------------------------------------- */
/* List                                                                        */
/* -------------------------------------------------------------------------- */

const tickets = ref<SupportTicketDto[]>([])
const loading = ref(true)
const cursor = ref<string | null>(null)
const hasMore = ref(false)

let controller: AbortController | null = null

async function load(reset: boolean): Promise<void> {
  controller?.abort()
  const request = new AbortController()
  controller = request
  loading.value = true

  try {
    const page = await supportApi.mine(reset ? undefined : (cursor.value ?? undefined), 20, request.signal)
    tickets.value = reset ? page.items : [...tickets.value, ...page.items]
    cursor.value = page.nextCursor
    hasMore.value = page.hasMore
  } catch (cause: unknown) {
    if (AbortError.is(cause)) return
    toast.error(translateError(cause))
  } finally {
    if (controller === request) {
      loading.value = false
      controller = null
    }
  }
}

onMounted(() => load(true))
onUnmounted(() => controller?.abort())

function open(ticket: SupportTicketDto): void {
  void router.push(`/support/${ticket.id}`)
}

function statusClass(status: SupportTicketDto['status']): string {
  if (status === 'open') return 'bg-primary/20 text-primary'
  if (status === 'replied') return 'bg-accent-blue/20 text-accent-blue'
  return 'bg-white/10 text-text-muted'
}
</script>

<template>
  <div class="support-page container mx-auto px-4 py-8 max-w-2xl">
    <h1 class="text-4xl font-bold text-text-primary mb-8">{{ t('support.title') }}</h1>

    <Card variant="glass" class="p-6 space-y-4 mb-8">
      <h2 class="text-lg font-semibold text-text-primary">{{ t('support.newTicket') }}</h2>

      <div>
        <label class="block text-sm text-text-secondary mb-1">{{ t('support.category') }}</label>
        <Select v-model="category" :options="categoryOptions" />
      </div>

      <div>
        <label class="block text-sm text-text-secondary mb-1">{{ t('support.subject') }}</label>
        <Input v-model="subject" :maxlength="200" :placeholder="t('support.subjectPlaceholder')" />
      </div>

      <div>
        <label class="block text-sm text-text-secondary mb-1">{{ t('support.message') }}</label>
        <Textarea v-model="message" :rows="4" :maxlength="5000" :placeholder="t('support.messagePlaceholder')" />
      </div>

      <Button
        variant="primary"
        :disabled="submitting || subject.trim().length === 0 || message.trim().length === 0"
        @click="submit"
      >
        <Send :size="16" />
        {{ submitting ? t('common.saving') : t('support.submit') }}
      </Button>
    </Card>

    <h2 class="text-lg font-semibold text-text-primary mb-3">{{ t('support.myTickets') }}</h2>

    <div v-if="loading && tickets.length === 0" class="space-y-2">
      <Card v-for="i in 3" :key="i" variant="glass" class="p-4 animate-pulse">
        <div class="h-4 bg-white/10 rounded w-1/2"></div>
      </Card>
    </div>

    <Card v-else-if="tickets.length === 0" variant="glass" class="p-12 text-center">
      <LifeBuoy :size="40" class="mx-auto mb-3 text-text-muted" />
      <p class="text-text-secondary">{{ t('support.empty') }}</p>
    </Card>

    <div v-else class="space-y-2">
      <button
        v-for="ticket in tickets"
        :key="ticket.id"
        type="button"
        class="w-full text-left"
        @click="open(ticket)"
      >
        <Card variant="glass" class="p-4 hover:bg-white/5 transition-smooth">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <p class="text-text-primary font-medium truncate">{{ ticket.subject }}</p>
              <p class="text-text-muted text-xs mt-0.5">{{ t(`support.categories.${ticket.category}`) }}</p>
            </div>
            <span class="shrink-0 px-2 py-0.5 rounded-full text-xs font-medium" :class="statusClass(ticket.status)">
              {{ t(`support.statuses.${ticket.status}`) }}
            </span>
          </div>
          <p class="text-text-secondary text-sm mt-2 truncate">{{ ticket.lastMessage }}</p>
        </Card>
      </button>

      <div v-if="hasMore" class="text-center pt-2">
        <Button variant="ghost" size="sm" :disabled="loading" @click="load(false)">
          {{ t('common.loadMore') }}
        </Button>
      </div>
    </div>
  </div>
</template>
