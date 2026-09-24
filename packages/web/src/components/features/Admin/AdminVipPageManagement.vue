<script setup lang="ts">
/**
 * VIP page — admin dashboard tab.
 *
 * A single mutable row (title + markdown body), not a history table — see
 * the schema's own doc comment (`packages/database/src/schema/pages.ts`).
 * Saving overwrites the page in place; there is no draft/publish lifecycle
 * like the blog has.
 */

import { onMounted, onUnmounted, ref } from 'vue'
import { MdEditor } from 'md-editor-v3'
import 'md-editor-v3/lib/style.css'
import { Crown, Save } from 'lucide-vue-next'
import { SitePageSlug } from '@playanime/contracts'
import { AbortError, pagesApi } from '@/api'
import { useApiError } from '@/composables/useApiError'
import { useLocale } from '@/composables/useLocale'
import { useToast } from '@/composables/useToast'
import Card from '@/components/ui/Card.vue'
import Input from '@/components/ui/Input.vue'
import Button from '@/components/ui/Button.vue'

const { t } = useLocale()
const { translateError } = useApiError()
const toast = useToast()

const title = ref('')
const contentMarkdown = ref('')
const updatedAt = ref<string | null>(null)
const loading = ref(true)
const saving = ref(false)

let controller: AbortController | null = null

async function load(): Promise<void> {
  controller?.abort()
  const request = new AbortController()
  controller = request
  loading.value = true

  try {
    const page = await pagesApi.get(SitePageSlug.VIP, request.signal)
    title.value = page?.title ?? ''
    contentMarkdown.value = page?.contentMarkdown ?? ''
    updatedAt.value = page?.updatedAt ?? null
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
  if (saving.value || title.value.trim().length === 0) return
  saving.value = true

  try {
    const updated = await pagesApi.update(SitePageSlug.VIP, {
      title: title.value.trim(),
      contentMarkdown: contentMarkdown.value
    })
    updatedAt.value = updated?.updatedAt ?? null
    toast.success(t('common.saveChanges'))
  } catch (cause: unknown) {
    toast.error(translateError(cause))
  } finally {
    saving.value = false
  }
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString()
}
</script>

<template>
  <div class="admin-vip-page space-y-6">
    <h2 class="text-2xl font-bold text-text-primary">{{ t('admin.vipPage.title') }}</h2>

    <div v-if="loading" class="space-y-4">
      <Card variant="glass" class="p-6 animate-pulse h-96" />
    </div>

    <template v-else>
      <Card variant="glass" class="p-6 space-y-4">
        <div class="flex items-center gap-2 text-text-secondary">
          <Crown :size="18" />
          <span class="text-sm">{{ t('admin.vipPage.hint') }}</span>
        </div>

        <div>
          <label class="block text-sm text-text-secondary mb-1">{{ t('admin.vipPage.pageTitle') }}</label>
          <Input v-model="title" variant="glass" :maxlength="200" />
        </div>
      </Card>

      <Card variant="glass" class="p-2 md:p-3">
        <label class="block text-sm text-text-secondary px-2 pt-1 pb-2">{{ t('admin.vipPage.content') }} (Markdown)</label>
        <MdEditor
          v-model="contentMarkdown"
          theme="dark"
          language="en-US"
          :toolbars-exclude="['github']"
          class="vip-md-editor"
          style="height: 32rem"
        />
      </Card>

      <div class="flex items-center gap-4">
        <Button variant="primary" :disabled="saving || title.trim().length === 0" @click="save">
          <Save :size="16" />
          {{ saving ? t('common.saving') : t('common.saveChanges') }}
        </Button>
        <p v-if="updatedAt !== null" class="text-xs text-text-muted">
          {{ t('admin.vipPage.lastUpdated') }}: {{ formatDate(updatedAt) }}
        </p>
      </div>
    </template>
  </div>
</template>

<style scoped>
@reference "@/styles/main.css";

.vip-md-editor :deep(.md-editor) {
  @apply rounded-lg;
}
</style>
