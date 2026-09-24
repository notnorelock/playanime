<script setup lang="ts">
/**
 * Support ticket queue.
 *
 * Same shape as `AdminContactInbox.vue`: a filterable list of envelopes,
 * opening one loads the full ordered thread and lets staff reply. Unlike
 * contact, a ticket also has an explicit "close" action (no further reply
 * expected) and a reply notifies the submitter in-app, not by email.
 */

import { onMounted, onUnmounted, ref, watch } from 'vue'
import { Clock, LifeBuoy, MailOpen, Send, XCircle } from 'lucide-vue-next'
import type { SupportTicketDto, SupportTicketStatus, SupportTicketThreadDto } from '@playanime/contracts'
import { AbortError, supportApi } from '@/api'
import { useApiError } from '@/composables/useApiError'
import { useLocale } from '@/composables/useLocale'
import { useToast } from '@/composables/useToast'
import Card from '@/components/ui/Card.vue'
import Button from '@/components/ui/Button.vue'
import Modal from '@/components/ui/Modal/Modal.vue'
import Textarea from '@/components/ui/Textarea.vue'

type Filter = 'open' | 'all'

const { t, locale } = useLocale()
const { translateError } = useApiError()
const toast = useToast()

const tickets = ref<SupportTicketDto[]>([])
const loading = ref(true)
const filter = ref<Filter>('open')

let controller: AbortController | null = null

async function load(): Promise<void> {
  controller?.abort()
  const request = new AbortController()
  controller = request
  loading.value = true

  try {
    const status: SupportTicketStatus | undefined = filter.value === 'open' ? 'open' : undefined
    const page = await supportApi.list(status, undefined, 50, request.signal)
    tickets.value = page.items
  } catch (cause: unknown) {
    if (AbortError.is(cause)) return
    tickets.value = []
    toast.error(translateError(cause))
  } finally {
    if (controller === request) {
      loading.value = false
      controller = null
    }
  }
}

onMounted(load)
watch(filter, load)
onUnmounted(() => controller?.abort())

/* -------------------------------------------------------------------------- */
/* Thread + reply                                                              */
/* -------------------------------------------------------------------------- */

const thread = ref<SupportTicketThreadDto | null>(null)
const threadLoading = ref(false)
const replyText = ref('')
const submitting = ref(false)
const closing = ref(false)

async function open(ticket: SupportTicketDto): Promise<void> {
  replyText.value = ''
  threadLoading.value = true
  thread.value = null

  try {
    thread.value = await supportApi.thread(ticket.id)
  } catch (cause: unknown) {
    toast.error(translateError(cause))
  } finally {
    threadLoading.value = false
  }
}

function close(): void {
  thread.value = null
}

async function submit(): Promise<void> {
  const ticket = thread.value
  if (ticket === null || replyText.value.trim().length === 0) return

  submitting.value = true

  try {
    await supportApi.reply(ticket.id, replyText.value.trim())
    toast.success(t('admin.support.replySent'))
    close()
    await load()
  } catch (cause: unknown) {
    toast.error(translateError(cause))
  } finally {
    submitting.value = false
  }
}

async function closeTicket(): Promise<void> {
  const ticket = thread.value
  if (ticket === null) return

  closing.value = true

  try {
    await supportApi.close(ticket.id)
    toast.success(t('admin.support.closed'))
    close()
    await load()
  } catch (cause: unknown) {
    toast.error(translateError(cause))
  } finally {
    closing.value = false
  }
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(locale.value, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}
</script>

<template>
  <div class="admin-support-queue space-y-6">
    <div class="flex items-center justify-between flex-wrap gap-3">
      <h2 class="text-2xl font-bold text-text-primary">{{ t('admin.support.title') }}</h2>

      <div class="flex items-center gap-2">
        <button
          type="button"
          class="px-3 py-1.5 rounded-lg text-sm transition-smooth"
          :class="filter === 'open' ? 'bg-primary text-white' : 'text-text-secondary hover:bg-white/10'"
          @click="filter = 'open'"
        >
          {{ t('admin.support.filterOpen') }}
        </button>
        <button
          type="button"
          class="px-3 py-1.5 rounded-lg text-sm transition-smooth"
          :class="filter === 'all' ? 'bg-primary text-white' : 'text-text-secondary hover:bg-white/10'"
          @click="filter = 'all'"
        >
          {{ t('admin.support.filterAll') }}
        </button>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="space-y-3">
      <Card v-for="i in 3" :key="i" variant="glass" class="p-5 animate-pulse">
        <div class="h-4 bg-white/10 rounded w-1/3 mb-2"></div>
        <div class="h-3 bg-white/10 rounded w-1/2"></div>
      </Card>
    </div>

    <!-- Queue -->
    <template v-else-if="tickets.length > 0">
      <Card
        v-for="ticket in tickets"
        :key="ticket.id"
        variant="glass"
        class="p-5 cursor-pointer hover:glass-strong transition-smooth"
        @click="open(ticket)"
      >
        <div class="flex items-start justify-between gap-4 flex-wrap">
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2 flex-wrap mb-1">
              <span class="font-semibold text-text-primary">{{ ticket.subject }}</span>
              <span
                v-if="ticket.status === 'open'"
                class="px-2 py-0.5 rounded-full text-xs bg-primary/20 text-primary"
              >
                {{ t('support.statuses.open') }}
              </span>
              <span
                v-else-if="ticket.status === 'replied'"
                class="px-2 py-0.5 rounded-full text-xs bg-accent-blue/20 text-accent-blue flex items-center gap-1"
              >
                <MailOpen :size="12" />
                {{ t('support.statuses.replied') }}
              </span>
              <span v-else class="px-2 py-0.5 rounded-full text-xs bg-white/10 text-text-muted">
                {{ t('support.statuses.closed') }}
              </span>
            </div>

            <p class="text-sm text-text-secondary mb-1">
              {{ ticket.submitterUsername }} · {{ t(`support.categories.${ticket.category}`) }}
            </p>
            <p class="text-sm text-text-muted mb-2 line-clamp-2 whitespace-pre-wrap">{{ ticket.lastMessage }}</p>

            <div class="flex items-center gap-4 text-xs text-text-muted flex-wrap">
              <span class="flex items-center gap-1">
                <Clock :size="12" />
                {{ formatDate(ticket.createdAt) }}
              </span>
            </div>
          </div>
        </div>
      </Card>
    </template>

    <Card v-else variant="glass" class="p-12 text-center text-text-secondary">
      <LifeBuoy :size="40" class="mx-auto mb-3 text-text-muted" />
      {{ filter === 'open' ? t('admin.support.emptyOpen') : t('admin.support.emptyAll') }}
    </Card>

    <!-- Thread dialog -->
    <Modal :model-value="thread !== null || threadLoading" size="lg" @update:model-value="close">
      <div v-if="threadLoading" class="p-8 text-center text-text-secondary">{{ t('common.loading') }}</div>

      <div v-else-if="thread" class="space-y-4 p-2">
        <div class="flex items-start justify-between gap-3">
          <div>
            <h3 class="text-xl font-semibold text-text-primary">{{ thread.subject }}</h3>
            <p class="text-sm text-text-secondary">
              {{ thread.submitterUsername }} · {{ t(`support.categories.${thread.category}`) }}
            </p>
          </div>
          <Button
            v-if="thread.status !== 'closed'"
            variant="ghost"
            size="sm"
            class="text-red-400 hover:text-red-300 shrink-0"
            :disabled="closing"
            @click="closeTicket"
          >
            <XCircle :size="16" />
            {{ t('admin.support.close') }}
          </Button>
        </div>

        <!-- Thread -->
        <div class="space-y-3 max-h-80 overflow-y-auto pr-1">
          <div
            v-for="entry in thread.messages"
            :key="entry.id"
            class="p-3 rounded-lg"
            :class="
              entry.direction === 'staff'
                ? 'bg-primary/10 border-l-2 border-primary/40'
                : 'bg-white/5 border-l-2 border-white/20'
            "
          >
            <p class="text-xs text-text-muted mb-1 flex items-center gap-1">
              <Send v-if="entry.direction === 'staff'" :size="10" />
              {{
                entry.direction === 'staff'
                  ? t('admin.support.repliedBy', { name: entry.sentByUsername ?? '—' })
                  : thread.submitterUsername
              }}
              · {{ formatDate(entry.createdAt) }}
            </p>
            <p class="text-sm text-text-primary whitespace-pre-wrap">{{ entry.body }}</p>
          </div>
        </div>

        <div v-if="thread.status !== 'closed'">
          <label class="block text-sm text-text-secondary mb-1">
            {{ t('admin.support.replyLabel') }}
          </label>
          <Textarea v-model="replyText" :rows="4" :placeholder="t('admin.support.replyPlaceholder')" />
        </div>

        <div class="flex justify-end gap-2 pt-2">
          <Button variant="ghost" @click="close">{{ t('common.cancel') }}</Button>
          <Button
            v-if="thread.status !== 'closed'"
            variant="primary"
            :disabled="submitting || replyText.trim().length === 0"
            @click="submit"
          >
            {{ submitting ? t('common.saving') : t('admin.support.sendReply') }}
          </Button>
        </div>
      </div>
    </Modal>
  </div>
</template>
