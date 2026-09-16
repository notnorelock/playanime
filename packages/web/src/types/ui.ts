/**
 * UI-related type definitions
 */

export interface Toast {
  id: string
  type: 'success' | 'error' | 'warning' | 'info'
  message: string
  duration?: number
}

export interface Modal {
  id: string
  component: string
  props?: Record<string, any>
  onClose?: () => void
}
