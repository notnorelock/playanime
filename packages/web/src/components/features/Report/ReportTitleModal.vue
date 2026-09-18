<script setup lang="ts">
/**
 * "Report this title" form.
 *
 * Open to anonymous visitors, matching the backend's own deliberate design —
 * a rights holder is usually not a registered user, and gating a copyright
 * complaint behind an account would make the takedown path unusable for
 * exactly the people who most need it. The copyright-specific fields
 * (attestation checkbox, contact email) only appear once that type is
 * selected, mirroring the backend's own conditional validation in
 * `reports.controller.ts`.
 */

import { computed, ref, watch } from 'vue'
import { Check, Copy } from 'lucide-vue-next'
import { ReportType } from '@playanime/contracts'
import { reportsApi } from '@/api'
import { useApiError } from '@/composables/useApiError'
import { useLocale } from '@/composables/useLocale'
import { useAuthStore } from '@/store/auth'
import Modal from '@/components/ui/Modal/Modal.vue'
import Select from '@/components/ui/Select.vue'
import Input from '@/components/ui/Input.vue'
import Textarea from '@/components/ui/Textarea.vue'
import Button from '@/components/ui/Button.vue'

const props = defineProps<{
  modelValue: boolean
  animeId: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const { t } = useLocale()
const { translateError } = useApiError()
const authStore = useAuthStore()

const typeOptions = computed(() => [
  { label: t('reports.types.copyright'), value: ReportType.COPYRIGHT },
  { label: t('reports.types.misleadingMetadata'), value: ReportType.MISLEADING_METADATA },
  { label: t('reports.types.other'), value: ReportType.OTHER }
])

const type = ref<string>(ReportType.OTHER)
const reason = ref('')
const description = ref('')
const email = ref('')
const rightsHolderAttested = ref(false)
const submitting = ref(false)
const reference = ref<string | null>(null)
const copied = ref(false)
const submissionError = ref<string | null>(null)

const isCopyright = computed(() => type.value === ReportType.COPYRIGHT)

function reset(): void {
  type.value = ReportType.OTHER
  reason.value = ''
  description.value = ''
  email.value = ''
  rightsHolderAttested.value = false
  reference.value = null
  copied.value = false
  submissionError.value = null
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) reset()
  }
)

function close(): void {
  emit('update:modelValue', false)
}

const canSubmit = computed(() => {
  if (reason.value.trim().length === 0) return false
  if (isCopyright.value && !rightsHolderAttested.value) return false
  if (isCopyright.value && !authStore.isAuthenticated && email.value.trim().length === 0) return false
  return true
})

async function submit(): Promise<void> {
  if (!canSubmit.value) return
  submitting.value = true
  submissionError.value = null

  try {
    const response = await reportsApi.submit({
      type: type.value as (typeof ReportType)[keyof typeof ReportType],
      targetType: 'anime',
      targetId: props.animeId,
      reason: reason.value.trim(),
      ...(description.value.trim().length > 0 ? { description: description.value.trim() } : {}),
      ...(authStore.isAuthenticated ? {} : { reporterEmail: email.value.trim() }),
      ...(isCopyright.value ? { rightsHolderAttested: true } : {})
    })
    reference.value = response.reference
  } catch (cause: unknown) {
    reference.value = null
    // Surfaced inline below rather than a toast — the reference number and
    // any validation problem both belong in the same place the form is.
    submissionError.value = translateError(cause)
  } finally {
    submitting.value = false
  }
}

async function copyReference(): Promise<void> {
  if (reference.value === null) return
  try {
    await navigator.clipboard.writeText(reference.value)
    copied.value = true
    setTimeout(() => {
      copied.value = false
    }, 2000)
  } catch {
    // Clipboard access can be denied; the reference is still visible on screen.
  }
}
</script>

<template>
  <Modal :model-value="modelValue" :title="t('reports.modalTitle')" @update:model-value="close">
    <div v-if="reference !== null" class="space-y-4 text-center py-2">
      <p class="text-text-secondary">{{ t('reports.submittedMessage') }}</p>
      <div class="flex items-center justify-center gap-2">
        <code class="px-3 py-2 rounded-lg bg-dark-700 text-primary font-mono text-lg">
          {{ reference }}
        </code>
        <button
          type="button"
          class="p-2 rounded-lg hover:bg-white/10 text-text-secondary hover:text-text-primary transition-smooth"
          @click="copyReference"
        >
          <Check v-if="copied" :size="18" />
          <Copy v-else :size="18" />
        </button>
      </div>
      <Button variant="glass" @click="close">{{ t('common.close') }}</Button>
    </div>

    <form v-else class="space-y-4" @submit.prevent="submit">
      <div>
        <label class="block text-sm text-text-secondary mb-1">{{ t('reports.typeLabel') }}</label>
        <Select v-model="type" :options="typeOptions" />
      </div>

      <div>
        <label class="block text-sm text-text-secondary mb-1">{{ t('reports.reasonLabel') }}</label>
        <Input v-model="reason" :placeholder="t('reports.reasonPlaceholder')" />
      </div>

      <div>
        <label class="block text-sm text-text-secondary mb-1">{{ t('reports.descriptionLabel') }}</label>
        <Textarea v-model="description" :rows="3" :placeholder="t('reports.descriptionPlaceholder')" />
      </div>

      <template v-if="isCopyright">
        <div v-if="!authStore.isAuthenticated">
          <label class="block text-sm text-text-secondary mb-1">{{ t('reports.emailLabel') }}</label>
          <Input v-model="email" type="email" :placeholder="t('reports.emailPlaceholder')" />
        </div>

        <label class="flex items-start gap-2 text-sm text-text-secondary">
          <input v-model="rightsHolderAttested" type="checkbox" class="accent-primary mt-0.5" />
          <span>{{ t('reports.rightsHolderAttestation') }}</span>
        </label>
      </template>

      <p v-if="submissionError" class="text-sm text-red-400">{{ submissionError }}</p>

      <div class="flex justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" @click="close">{{ t('common.cancel') }}</Button>
        <Button type="submit" variant="primary" :disabled="!canSubmit || submitting">
          {{ submitting ? t('common.saving') : t('reports.submit') }}
        </Button>
      </div>
    </form>
  </Modal>
</template>
