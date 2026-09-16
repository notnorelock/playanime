/**
 * useStorage Composable
 * Reactive localStorage wrapper with Vue integration
 * @module composables/useStorage
 */

import { ref, watch, type Ref } from 'vue'
import { Storage, type StorageOptions } from '@/utils/storage'

/**
 * Composable options
 */
export interface UseStorageOptions<T> extends StorageOptions<T> {
  /**
   * Whether to watch for changes and sync with localStorage
   */
  watchForChanges?: boolean

  /**
   * Debounce time in milliseconds for saving changes (default: 0)
   */
  debounce?: number

  /**
   * Callback when value is loaded from storage
   */
  onLoad?: (value: T) => void

  /**
   * Callback when value is saved to storage
   */
  onSave?: (value: T) => void

  /**
   * Callback when an error occurs
   */
  onError?: (error: Error) => void
}

/**
 * Reactive localStorage composable
 * @param key Storage key
 * @param defaultValue Default value if key doesn't exist
 * @param options Storage options
 */
export function useStorage<T>(
  key: string,
  defaultValue: T,
  options: UseStorageOptions<T> = {}
): {
  value: Ref<T>
  save: () => void
  remove: () => void
  reset: () => void
  isLoading: Ref<boolean>
  error: Ref<Error | null>
} {
  const {
    watchForChanges = true,
    debounce = 0,
    onLoad,
    onSave,
    onError,
    ...storageOptions
  } = options

  // Create storage instance
  const storage = new Storage<T>({
    ...storageOptions,
    defaultValue
  })

  // Reactive state
  const value = ref<T>(defaultValue) as Ref<T>
  const isLoading = ref(true)
  const error = ref<Error | null>(null)

  // Debounce timer
  let debounceTimer: NodeJS.Timeout | null = null

  // Load value from storage
  const load = () => {
    try {
      isLoading.value = true
      error.value = null

      const stored = storage.get(key)
      if (stored !== undefined) {
        value.value = stored
        onLoad?.(stored)
      } else {
        value.value = defaultValue
      }
    } catch (err) {
      const errorObj = err instanceof Error ? err : new Error(String(err))
      error.value = errorObj
      onError?.(errorObj)
      console.error(`[useStorage] Failed to load key "${key}":`, err)
    } finally {
      isLoading.value = false
    }
  }

  // Save value to storage
  const save = () => {
    try {
      error.value = null
      storage.set(key, value.value)
      onSave?.(value.value)
    } catch (err) {
      const errorObj = err instanceof Error ? err : new Error(String(err))
      error.value = errorObj
      onError?.(errorObj)
      console.error(`[useStorage] Failed to save key "${key}":`, err)
    }
  }

  // Debounced save
  const debouncedSave = () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer)
    }

    if (debounce > 0) {
      debounceTimer = setTimeout(() => {
        save()
        debounceTimer = null
      }, debounce)
    } else {
      save()
    }
  }

  // Remove value from storage
  const remove = () => {
    try {
      error.value = null
      storage.remove(key)
      value.value = defaultValue
    } catch (err) {
      const errorObj = err instanceof Error ? err : new Error(String(err))
      error.value = errorObj
      onError?.(errorObj)
      console.error(`[useStorage] Failed to remove key "${key}":`, err)
    }
  }

  // Reset to default value
  const reset = () => {
    value.value = defaultValue
    save()
  }

  // Watch for changes and save automatically
  if (watchForChanges) {
    watch(
      value,
      () => {
        debouncedSave()
      },
      { deep: true }
    )
  }

  // Load initial value
  load()

  return {
    value,
    save,
    remove,
    reset,
    isLoading,
    error
  }
}

/**
 * Simple reactive localStorage for primitive values
 * Shorthand for useStorage with automatic syncing
 */
export function useLocalStorage<T>(key: string, defaultValue: T, debounce = 0) {
  return useStorage(key, defaultValue, { debounce, prefix: 'app_' })
}

/**
 * Reactive localStorage with encryption
 */
export function useSecureStorage<T>(key: string, defaultValue: T, debounce = 0) {
  return useStorage(key, defaultValue, { debounce, prefix: 'secure_', encrypt: true })
}

/**
 * Reactive localStorage with expiration
 */
export function useTemporaryStorage<T>(
  key: string,
  defaultValue: T,
  expiresIn: number,
  debounce = 0
) {
  return useStorage(key, defaultValue, { debounce, expiresIn, prefix: 'temp_' })
}
