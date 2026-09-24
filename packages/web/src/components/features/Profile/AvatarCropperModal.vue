<script setup lang="ts">
/**
 * Crop/zoom step shown after picking an avatar image, before it's ever
 * sent to the server — the server only ever receives an already-square
 * image and downscales it per size (see media.service.ts), it never
 * guesses a crop box itself.
 */

import { ref } from 'vue'
import { Cropper, CircleStencil } from 'vue-advanced-cropper'
import 'vue-advanced-cropper/dist/style.css'
import { Check } from 'lucide-vue-next'
import { useLocale } from '@/composables/useLocale'
import Modal from '@/components/ui/Modal/Modal.vue'
import Button from '@/components/ui/Button.vue'

const props = defineProps<{
  modelValue: boolean
  /** Object URL for the file the user just picked — caller owns revoking it. */
  imageSrc: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  cropped: [file: File]
}>()

const { t } = useLocale()

/** Larger than the biggest server-generated size (512) so downscaling on the server never upscales. */
const EXPORT_SIZE = 1024

const cropper = ref<InstanceType<typeof Cropper> | null>(null)
const exporting = ref(false)

function close(): void {
  emit('update:modelValue', false)
}

async function apply(): Promise<void> {
  const instance = cropper.value
  if (instance === null || exporting.value) return

  const result = instance.getResult()
  if (!result.canvas) return

  exporting.value = true

  try {
    const blob = await new Promise<Blob | null>((resolve) => {
      result.canvas?.toBlob(resolve, 'image/png')
    })
    if (blob === null) return

    emit('cropped', new File([blob], 'avatar.png', { type: 'image/png' }))
  } finally {
    exporting.value = false
  }
}
</script>

<template>
  <Modal :model-value="modelValue" :title="t('profile.edit.cropTitle')" size="lg" @update:model-value="close">
    <div class="space-y-4">
      <div class="h-80 rounded-lg overflow-hidden bg-dark-900">
        <Cropper
          ref="cropper"
          class="h-full w-full"
          :src="imageSrc"
          :stencil-component="CircleStencil"
          :stencil-props="{ aspectRatio: 1 }"
          :canvas="{ width: EXPORT_SIZE, height: EXPORT_SIZE }"
        />
      </div>

      <p class="text-xs text-text-muted">{{ t('profile.edit.cropHint') }}</p>

      <div class="flex justify-end gap-2">
        <Button variant="ghost" @click="close">{{ t('common.cancel') }}</Button>
        <Button variant="primary" :disabled="exporting" @click="apply">
          <Check :size="16" />
          {{ exporting ? t('common.saving') : t('profile.edit.cropApply') }}
        </Button>
      </div>
    </div>
  </Modal>
</template>
