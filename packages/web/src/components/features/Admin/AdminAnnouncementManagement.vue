<script setup lang="ts">
/**
 * Homepage announcement strip — admin dashboard tab.
 *
 * One panel, not a separate page: the form is three fields (message, link
 * URL, link label), nothing close to needing the room a blog post's
 * markdown editor does. Setting a new announcement replaces whatever was
 * active — see the schema's own doc comment for why this is a small
 * history table under the hood rather than one mutable row.
 */

import { onMounted, onUnmounted, ref } from 'vue'
import { Megaphone, Trash2 } from 'lucide-vue-next'
import type { AnnouncementDto } from '@playanime/contracts'
import { AbortError, announcementsApi } from '@/api'
import { useApiError } from '@/composables/useApiError'
import { useLocale } from '@/composables/useLocale'
import { useToast } from '@/composables/useToast'
import Card from '@/components/ui/Card.vue'
import Input from '@/components/ui/Input.vue'
import Textarea from '@/components/ui/Textarea.vue'
import Button from '@/components/ui/Button.vue'

const { t } = useLocale()
const { translateError } = useApiError()
const toast = useToast()

const history = ref<AnnouncementDto[]>([])
const loading = ref(true)
const saving = ref(false)
const clearing = ref(false)

const message = ref('')
const linkUrl = ref('')
const linkLabel = ref('')

let controller: AbortController | null = null

const active = ref<AnnouncementDto | null>(null)

async function load(): Promise<void> {
  controller?.abort()
  const request = new AbortController()
  controller = request
  loading.value = true

  try {
    history.value = await announcementsApi.history(request.signal)
    active.value = history.value.find((entry) => entry.isActive) ?? null
    if (active.value !== null) {
      message.value = active.value.message
      linkUrl.value = active.value.linkUrl ?? ''
      linkLabel.value = active.value.linkLabel ?? ''
    }
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

onMounted(load)
onUnmounted(() => controller?.abort())

async function save(): Promise<void> {
  if (saving.value || message.value.trim().length === 0) return
  saving.value = true

  try {
    await announcementsApi.set({
      message: message.value.trim(),
      linkUrl: linkUrl.value.trim().length === 0 ? null : linkUrl.value.trim(),
      linkLabel: linkLabel.value.trim().length === 0 ? null : linkLabel.value.trim()
    })
    toast.success(t('admin.announcements.saved'))
    await load()
  } catch (cause: unknown) {
    toast.error(translateError(cause))
  } finally {
    saving.value = false
  }
}

async function clear(): Promise<void> {
  if (clearing.value || active.value === null) return
  clearing.value = true

  try {
    await announcementsApi.clear()
    message.value = ''
    linkUrl.value = ''
    linkLabel.value = ''
    toast.success(t('admin.announcements.cleared'))
    await load()
  } catch (cause: unknown) {
    toast.error(translateError(cause))
  } finally {
    clearing.value = false
  }
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString()
}
</script>

<template>
  <div class="admin-announcements space-y-6">
    <h2 class="text-2xl font-bold text-text-primary">{{ t('admin.announcements.title') }}</h2>

    <Card variant="glass" class="p-6 space-y-4">
      <div class="flex items-center gap-2 text-text-secondary">
        <Megaphone :size="18" />
        <span class="text-sm">{{ t('admin.announcements.hint') }}</span>
      </div>

      <div>
        <label class="block text-sm text-text-secondary mb-1">{{ t('admin.announcements.message') }}</label>
        <Textarea v-model="message" :rows="2" :maxlength="500" variant="glass" />
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label class="block text-sm text-text-secondary mb-1">{{ t('admin.announcements.linkUrl') }}</label>
          <Input v-model="linkUrl" variant="glass" placeholder="https://…" />
        </div>
        <div>
          <label class="block text-sm text-text-secondary mb-1">{{ t('admin.announcements.linkLabel') }}</label>
          <Input v-model="linkLabel" variant="glass" :maxlength="100" />
        </div>
      </div>

      <div class="flex gap-2">
        <Button variant="primary" :disabled="saving || message.trim().length === 0" @click="save">
          {{ saving ? t('common.saving') : t('admin.announcements.publish') }}
        </Button>
        <Button v-if="active" variant="ghost" class="text-red-400 hover:text-red-300" :disabled="clearing" @click="clear">
          <Trash2 :size="16" />
          {{ t('admin.announcements.clear') }}
        </Button>
      </div>
    </Card>

    <div>
      <h3 class="text-lg font-semibold text-text-primary mb-3">{{ t('admin.announcements.history') }}</h3>

      <div v-if="loading" class="space-y-2">
        <Card v-for="i in 3" :key="i" variant="glass" class="p-4 animate-pulse">
          <div class="h-4 bg-white/10 rounded w-1/2"></div>
        </Card>
      </div>

      <div v-else-if="history.length > 0" class="space-y-2">
        <Card
          v-for="entry in history"
          :key="entry.id"
          variant="glass"
          class="p-4"
          :class="{ 'ring-1 ring-primary': entry.isActive }"
        >
          <div class="flex items-start justify-between gap-3">
            <p class="text-text-primary text-sm flex-1">{{ entry.message }}</p>
            <span
              v-if="entry.isActive"
              class="shrink-0 px-2 py-0.5 rounded-full text-xs font-medium bg-primary/20 text-primary"
            >
              {{ t('admin.announcements.active') }}
            </span>
          </div>
          <p class="text-xs text-text-muted mt-1">
            {{ entry.createdByUsername ?? t('sources.asStaff') }} — {{ formatDate(entry.createdAt) }}
          </p>
        </Card>
      </div>

      <Card v-else variant="glass" class="p-8 text-center text-text-secondary">
        {{ t('admin.announcements.noHistory') }}
      </Card>
    </div>
  </div>
</template>
