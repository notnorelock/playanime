<script setup lang="ts">
/**
 * ConfirmModal Component
 * Confirmation dialog with confirm/cancel actions
 */

import Modal from './Modal.vue'
import Button from '@/components/ui/Button.vue'

interface Props {
  modelValue: boolean
  title?: string
  message: string
  confirmText?: string
  cancelText?: string
  confirmVariant?: 'primary' | 'danger'
  loading?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  title: 'Confirm Action',
  confirmText: 'Confirm',
  cancelText: 'Cancel',
  confirmVariant: 'primary',
  loading: false
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'confirm': []
  'cancel': []
}>()

const handleConfirm = () => {
  emit('confirm')
}

const handleCancel = () => {
  emit('update:modelValue', false)
  emit('cancel')
}

const handleClose = () => {
  if (!props.loading) {
    handleCancel()
  }
}
</script>

<template>
  <Modal
    :model-value="modelValue"
    :title="title"
    size="sm"
    :close-on-overlay="!loading"
    :close-on-esc="!loading"
    @update:model-value="$emit('update:modelValue', $event)"
    @close="handleClose"
  >
    <!-- Message -->
    <div class="text-text-primary text-center py-2">
      {{ message }}
    </div>

    <!-- Actions -->
    <template #footer>
      <div class="flex gap-3 justify-end">
        <Button
          variant="ghost"
          :disabled="loading"
          @click="handleCancel"
        >
          {{ cancelText }}
        </Button>
        <Button
          :variant="confirmVariant === 'danger' ? 'secondary' : 'primary'"
          :class="{ 'bg-red-500 hover:bg-red-600': confirmVariant === 'danger' }"
          :loading="loading"
          :disabled="loading"
          @click="handleConfirm"
        >
          {{ confirmText }}
        </Button>
      </div>
    </template>
  </Modal>
</template>
