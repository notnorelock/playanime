<script setup lang="ts">
/**
 * Contact inbox.
 *
 * The only place a message is ever actually read or answered —
 * `CONTACT_EMAIL` isn't an inbox staff can log into. A conversation may
 * hold several messages (the original submission, staff replies, and —
 * once Resend's inbound receiving is configured for the domain — a
 * visitor's own reply-email); the list view shows each conversation's
 * latest message as a preview, and opening one loads the full ordered
 * thread via `GET /contact/messages/:id`.
 */

import { onMounted, onUnmounted, ref, watch } from 'vue'
import { Clock, Mail, MailOpen, Send } from 'lucide-vue-next'
import type { ContactMessageDto, ContactMessageThreadDto } from '@playanime/contracts'
import { AbortError, adminApi } from '@/api'
import { useApiError } from '@/composables/useApiError'
import { useLocale } from '@/composables/useLocale'
import { useToast } from '@/composables/useToast'
import Card from '@/components/ui/Card.vue'
import Button from '@/components/ui/Button.vue'
import Modal from '@/components/ui/Modal/Modal.vue'
import Textarea from '@/components/ui/Textarea.vue'

type Filter = 'new' | 'all'

const { t, locale } = useLocale()
const { translateError } = useApiError()
const toast = useToast()

const messages = ref<ContactMessageDto[]>([])
const loading = ref(true)
const filter = ref<Filter>('new')

let controller: AbortController | null = null

async function load(): Promise<void> {
  controller?.abort()
  const request = new AbortController()
  controller = request
  loading.value = true

  try {
    messages.value = await adminApi.contactMessages(
      filter.value === 'new' ? 'new' : undefined,
      50,
      request.signal
    )
  } catch (cause: unknown) {
    if (AbortError.is(cause)) return
    messages.value = []
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

onUnmounted(() => {
  controller?.abort()
})

/* -------------------------------------------------------------------------- */
/* Thread + reply                                                              */
/* -------------------------------------------------------------------------- */

const thread = ref<ContactMessageThreadDto | null>(null)
const threadLoading = ref(false)
const replyText = ref('')
const submitting = ref(false)

async function open(message: ContactMessageDto): Promise<void> {
  replyText.value = ''
  threadLoading.value = true
  thread.value = null

  try {
    thread.value = await adminApi.contactThread(message.id)
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
  const conversation = thread.value
  if (conversation === null || replyText.value.trim().length === 0) return

  submitting.value = true

  try {
    await adminApi.replyToContactMessage(conversation.id, { replyText: replyText.value.trim() })
    toast.success(t('admin.contact.replySent'))
    close()
    await load()
  } catch (cause: unknown) {
    toast.error(translateError(cause))
  } finally {
    submitting.value = false
  }
}

function formatDate(value: string | null): string {
  if (value === null) return '—'
  return new Intl.DateTimeFormat(locale.value, { dateStyle: 'short', timeStyle: 'short' }).format(
    new Date(value)
  )
}
</script>

<template>
  <div class="admin-contact-inbox space-y-6">
    <div class="flex items-center justify-between flex-wrap gap-3">
      <h2 class="text-2xl font-bold text-text-primary">{{ t('admin.contact.title') }}</h2>

      <div class="flex items-center gap-2">
        <button
          type="button"
          class="px-3 py-1.5 rounded-lg text-sm transition-smooth"
          :class="filter === 'new' ? 'bg-primary text-white' : 'text-text-secondary hover:bg-white/10'"
          @click="filter = 'new'"
        >
          {{ t('admin.contact.filterNew') }}
        </button>
        <button
          type="button"
          class="px-3 py-1.5 rounded-lg text-sm transition-smooth"
          :class="filter === 'all' ? 'bg-primary text-white' : 'text-text-secondary hover:bg-white/10'"
          @click="filter = 'all'"
        >
          {{ t('admin.contact.filterAll') }}
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

    <!-- Inbox -->
    <template v-else-if="messages.length > 0">
      <Card
        v-for="message in messages"
        :key="message.id"
        variant="glass"
        class="p-5 cursor-pointer hover:glass-strong transition-smooth"
        @click="open(message)"
      >
        <div class="flex items-start justify-between gap-4 flex-wrap">
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2 flex-wrap mb-1">
              <span class="font-semibold text-text-primary">{{ message.subject }}</span>
              <span
                v-if="message.status === 'new'"
                class="px-2 py-0.5 rounded-full text-xs bg-primary/20 text-primary flex items-center gap-1"
              >
                <Mail :size="12" />
                {{ t('admin.contact.statusNew') }}
              </span>
              <span
                v-else
                class="px-2 py-0.5 rounded-full text-xs bg-green-500/20 text-green-400 flex items-center gap-1"
              >
                <MailOpen :size="12" />
                {{ t('admin.contact.statusReplied') }}
              </span>
            </div>

            <p class="text-sm text-text-secondary mb-1">{{ message.name }} &lt;{{ message.email }}&gt;</p>
            <p class="text-sm text-text-muted mb-2 line-clamp-2 whitespace-pre-wrap">{{ message.lastMessage }}</p>

            <div class="flex items-center gap-4 text-xs text-text-muted flex-wrap">
              <span class="flex items-center gap-1">
                <Clock :size="12" />
                {{ formatDate(message.createdAt) }}
              </span>
            </div>
          </div>
        </div>
      </Card>
    </template>

    <Card v-else variant="glass" class="p-12 text-center text-text-secondary">
      {{ filter === 'new' ? t('admin.contact.emptyNew') : t('admin.contact.emptyAll') }}
    </Card>

    <!-- Thread dialog -->
    <Modal :model-value="thread !== null || threadLoading" size="lg" @update:model-value="close">
      <div v-if="threadLoading" class="p-8 text-center text-text-secondary">{{ t('common.loading') }}</div>

      <div v-else-if="thread" class="space-y-4 p-2">
        <div>
          <h3 class="text-xl font-semibold text-text-primary">{{ thread.subject }}</h3>
          <p class="text-sm text-text-secondary">{{ thread.name }} &lt;{{ thread.email }}&gt;</p>
        </div>

        <!-- Thread -->
        <div class="space-y-3 max-h-80 overflow-y-auto pr-1">
          <div
            v-for="entry in thread.replies"
            :key="entry.id"
            class="p-3 rounded-lg"
            :class="
              entry.direction === 'outbound'
                ? 'bg-primary/10 border-l-2 border-primary/40'
                : 'bg-white/5 border-l-2 border-white/20'
            "
          >
            <p class="text-xs text-text-muted mb-1 flex items-center gap-1">
              <Send v-if="entry.direction === 'outbound'" :size="10" />
              {{
                entry.direction === 'outbound'
                  ? t('admin.contact.repliedBy', { name: entry.sentByUsername ?? '—' })
                  : (entry.fromAddress ?? thread.email)
              }}
              · {{ formatDate(entry.createdAt) }}
            </p>
            <p class="text-sm text-text-primary whitespace-pre-wrap">{{ entry.body }}</p>
          </div>
        </div>

        <div>
          <label class="block text-sm text-text-secondary mb-1">
            {{ t('admin.contact.replyLabel') }}
          </label>
          <Textarea v-model="replyText" :rows="4" :placeholder="t('admin.contact.replyPlaceholder')" />
        </div>

        <div class="flex justify-end gap-2 pt-2">
          <Button variant="ghost" @click="close">{{ t('common.cancel') }}</Button>
          <Button
            variant="primary"
            :disabled="submitting || replyText.trim().length === 0"
            @click="submit"
          >
            {{ submitting ? t('common.saving') : t('admin.contact.sendReply') }}
          </Button>
        </div>
      </div>
    </Modal>
  </div>
</template>
