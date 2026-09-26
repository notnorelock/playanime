<script setup lang="ts">
/**
 * ConfirmModal Component
 * Confirmation dialog with confirm/cancel actions
 */

import { computed, nextTick, ref, watch } from 'vue'
import Modal from './Modal.vue'
import Button from '@/components/ui/Button.vue'
import { useLocale } from '@/composables/useLocale'

interface Props {
  modelValue: boolean
  title?: string
  message: string
  confirmText?: string
  cancelText?: string
  confirmVariant?: 'primary' | 'danger'
  loading?: boolean
}

/**
 * No `withDefaults` for `title`/`confirmText`/`cancelText`: a prop default
 * is evaluated once, outside the component instance, so it cannot call
 * `useLocale()` — the old hardcoded English defaults ("Confirm Action",
 * "Confirm", "Cancel") leaked through untranslated on every call site that
 * omitted them (most of them; grep any `confirm({ ... })` call across the
 * app missing an explicit `title`). Computed fallbacks below read the
 * caller's locale instead.
 */
const props = withDefaults(defineProps<Props>(), {
  title: undefined,
  confirmText: undefined,
  cancelText: undefined,
  confirmVariant: 'primary',
  loading: false
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'confirm': []
  'cancel': []
}>()

const { t } = useLocale()

const resolvedTitle = computed(() => props.title ?? t('common.confirmAction'))
const resolvedConfirmText = computed(() => props.confirmText ?? t('common.confirm'))
const resolvedCancelText = computed(() => props.cancelText ?? t('common.cancel'))

const confirmButton = ref<InstanceType<typeof Button> | null>(null)

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

/**
 * Moves focus onto the Confirm button when the dialog opens. Without this,
 * focus stays on whatever page element opened the dialog (a row's trash
 * icon, say) — so pressing Enter to "confirm" actually re-activates that
 * button instead, opening a second, identical confirm dialog on top of the
 * first rather than confirming it. `$el` is the button's own root `<button>`
 * (Button.vue has exactly one root element, so Vue forwards the template ref
 * straight through it).
 */
watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    void nextTick(() => {
      (confirmButton.value?.$el as HTMLButtonElement | undefined)?.focus()
    })
  }
)
</script>

<template>
  <Modal
    :model-value="modelValue"
    :title="resolvedTitle"
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
          {{ resolvedCancelText }}
        </Button>
        <Button
          ref="confirmButton"
          :variant="confirmVariant === 'danger' ? 'secondary' : 'primary'"
          :class="{ 'bg-red-500 hover:bg-red-600': confirmVariant === 'danger' }"
          :loading="loading"
          :disabled="loading"
          @click="handleConfirm"
        >
          {{ resolvedConfirmText }}
        </Button>
      </div>
    </template>
  </Modal>
</template>
