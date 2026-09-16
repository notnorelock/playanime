/**
 * Confirm Dialog Composable
 * Provides a programmatic way to show confirmation dialogs
 */

import { ref, h, render, type VNode } from 'vue'
import ConfirmModal from '@/components/ui/Modal/ConfirmModal.vue'
import { useLocale } from './useLocale'

export interface ConfirmOptions {
  title?: string
  message: string
  confirmText?: string
  cancelText?: string
  confirmVariant?: 'primary' | 'danger'
}

export function useConfirm() {
  const { t } = useLocale()
  /**
   * Show a confirmation dialog
   * Returns a promise that resolves to true if confirmed, false if cancelled
   */
  const confirm = (options: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      const isOpen = ref(true)
      const loading = ref(false)

      const handleConfirm = async () => {
        loading.value = true
        // Small delay for better UX
        await new Promise(r => setTimeout(r, 200))
        isOpen.value = false
        cleanup()
        resolve(true)
      }

      const handleCancel = () => {
        isOpen.value = false
        cleanup()
        resolve(false)
      }

      const handleUpdateModelValue = (value: boolean) => {
        if (!value) {
          handleCancel()
        }
      }

      // Create modal instance
      const container = document.createElement('div')
      document.body.appendChild(container)

      const vnode: VNode = h(ConfirmModal, {
        modelValue: isOpen.value,
        title: options.title,
        message: options.message,
        confirmText: options.confirmText,
        cancelText: options.cancelText,
        confirmVariant: options.confirmVariant,
        loading: loading.value,
        'onUpdate:modelValue': handleUpdateModelValue,
        onConfirm: handleConfirm,
        onCancel: handleCancel
      })

      render(vnode, container)

      // Cleanup function
      const cleanup = () => {
        setTimeout(() => {
          render(null, container)
          document.body.removeChild(container)
        }, 300) // Wait for animation
      }
    })
  }

  /**
   * Show a delete confirmation dialog
   * Convenience method for delete actions
   */
  const confirmDelete = (itemName?: string): Promise<boolean> => {
    return confirm({
      title: t('common.confirmDelete'),
      message: itemName
        ? t('common.confirmDeleteMessage', { item: itemName })
        : t('common.confirmDeleteMessageDefault'),
      confirmText: t('common.delete'),
      cancelText: t('common.cancel'),
      confirmVariant: 'danger'
    })
  }

  return {
    confirm,
    confirmDelete
  }
}
