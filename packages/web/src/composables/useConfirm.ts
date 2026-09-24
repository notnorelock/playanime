/**
 * Confirm Dialog Composable
 * Provides a programmatic way to show confirmation dialogs
 */

import { h, render } from 'vue'
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
   *
   * Renders into a throwaway container, re-rendering on every state change —
   * `render(vnode, container)` called once with plain values baked into the
   * vnode's props does NOT update reactively; a previous version of this
   * function did exactly that, so `loading`/`isOpen` silently never reached
   * the DOM. The confirm button stayed mounted, focused and clickable for
   * the full ~500ms close animation, so a second Enter press during that
   * window re-fired the handler against whatever the page looked like by
   * then — surfacing as "confirming a delete pops up ANOTHER delete dialog"
   * once the list underneath had already re-rendered.
   */
  const confirm = (options: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      const container = document.createElement('div')
      document.body.appendChild(container)

      const state = { isOpen: true, loading: false }

      const renderModal = () => {
        render(
          h(ConfirmModal, {
            modelValue: state.isOpen,
            title: options.title,
            message: options.message,
            confirmText: options.confirmText,
            cancelText: options.cancelText,
            confirmVariant: options.confirmVariant,
            loading: state.loading,
            'onUpdate:modelValue': (value: boolean) => {
              if (!value) handleCancel()
            },
            onConfirm: () => void handleConfirm(),
            onCancel: handleCancel
          }),
          container
        )
      }

      const cleanup = () => {
        // Unmounts once the close transition (Modal.vue's 0.3s opacity/
        // transform) has had time to finish, matching Modal.vue's own
        // animation duration rather than a value chosen independently of it.
        setTimeout(() => {
          render(null, container)
          document.body.removeChild(container)
        }, 300)
      }

      const handleConfirm = async () => {
        // Disables the button immediately — closing the reactivity gap
        // above is what actually prevents the double-fire; this loading
        // state is user feedback for the gap between click and close, not
        // the guard itself.
        state.loading = true
        renderModal()
        await new Promise((r) => setTimeout(r, 200))
        state.isOpen = false
        renderModal()
        cleanup()
        resolve(true)
      }

      const handleCancel = () => {
        state.isOpen = false
        renderModal()
        cleanup()
        resolve(false)
      }

      renderModal()
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
