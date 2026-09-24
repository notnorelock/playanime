<script setup lang="ts">
/**
 * "Report this episode" form — reachable from the watch page. Requires
 * login (unlike `ReportTitleModal`'s anonymous copyright path): the
 * reporter gets an email with the outcome once staff resolves it, so there
 * has to be a real account behind the submission.
 */

import { computed, ref, watch } from 'vue'
import { Check } from 'lucide-vue-next'
import { EpisodeReportReason } from '@playanime/contracts'
import { episodeReportsApi } from '@/api'
import { useApiError } from '@/composables/useApiError'
import { useLocale } from '@/composables/useLocale'
import Modal from '@/components/ui/Modal/Modal.vue'
import Select from '@/components/ui/Select.vue'
import Textarea from '@/components/ui/Textarea.vue'
import Button from '@/components/ui/Button.vue'

const props = defineProps<{
  modelValue: boolean
  episodeId: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const { t } = useLocale()
const { translateError } = useApiError()

const reasonOptions = computed(() =>
  Object.values(EpisodeReportReason).map((value) => ({ label: t(`episodeReports.reasons.${value}`), value }))
)

const reason = ref<string>(EpisodeReportReason.VIDEO_NOT_PLAYING)
const description = ref('')
const submitting = ref(false)
const submitted = ref(false)
const submissionError = ref<string | null>(null)

function reset(): void {
  reason.value = EpisodeReportReason.VIDEO_NOT_PLAYING
  description.value = ''
  submitted.value = false
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

async function submit(): Promise<void> {
  submitting.value = true
  submissionError.value = null

  try {
    await episodeReportsApi.submit({
      episodeId: props.episodeId,
      reason: reason.value as EpisodeReportReason,
      ...(description.value.trim().length > 0 ? { description: description.value.trim() } : {})
    })
    submitted.value = true
  } catch (cause: unknown) {
    submissionError.value = translateError(cause)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <Modal :model-value="modelValue" :title="t('episodeReports.modalTitle')" @update:model-value="close">
    <div v-if="submitted" class="space-y-4 text-center py-2">
      <Check :size="32" class="mx-auto text-primary" />
      <p class="text-text-secondary">{{ t('episodeReports.submittedMessage') }}</p>
      <Button variant="glass" @click="close">{{ t('common.close') }}</Button>
    </div>

    <form v-else class="space-y-4" @submit.prevent="submit">
      <div>
        <label class="block text-sm text-text-secondary mb-1">{{ t('episodeReports.reasonLabel') }}</label>
        <Select v-model="reason" :options="reasonOptions" />
      </div>

      <div>
        <label class="block text-sm text-text-secondary mb-1">{{ t('episodeReports.descriptionLabel') }}</label>
        <Textarea v-model="description" :rows="3" :maxlength="2000" :placeholder="t('episodeReports.descriptionPlaceholder')" />
      </div>

      <p v-if="submissionError" class="text-sm text-red-400">{{ submissionError }}</p>

      <div class="flex justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" @click="close">{{ t('common.cancel') }}</Button>
        <Button type="submit" variant="primary" :disabled="submitting">
          {{ submitting ? t('common.saving') : t('episodeReports.submit') }}
        </Button>
      </div>
    </form>
  </Modal>
</template>
