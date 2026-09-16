/**
 * Settings Store - Pinia
 * Manages application settings with localStorage persistence
 */

import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { storage } from '@/utils/storage'
import { useInitializableStore } from '@/utils/store-initializer'
import type { SupportedLocale } from './localization'

/**
 * User settings interface
 */
export interface UserSettings {
  language: SupportedLocale
  theme: 'light' | 'dark' | 'auto'
  autoplay: boolean
  videoQuality: 'auto' | '360p' | '480p' | '720p' | '1080p'
  notifications: boolean
  privacyPolicyAccepted: boolean
}

/**
 * Default settings
 */
const DEFAULT_SETTINGS: UserSettings = {
  language: 'en',
  theme: 'dark',
  autoplay: true,
  videoQuality: 'auto',
  notifications: true,
  privacyPolicyAccepted: false
}

const settingsStoreDefinition = defineStore('settings', () => {
  // State
  const settings = ref<UserSettings>({ ...DEFAULT_SETTINGS })
  const loading = ref(false)
  const error = ref<string | null>(null)

  /**
   * Initialize settings from localStorage
   */
  async function initialize() {
    loading.value = true
    error.value = null

    try {
      const stored = storage.get('settings') as UserSettings | undefined

      if (stored) {
        // Merge stored settings with defaults (in case new settings were added)
        settings.value = { ...DEFAULT_SETTINGS, ...stored }
        console.log('Loaded from localStorage:', settings.value)
      } else {
        settings.value = { ...DEFAULT_SETTINGS }
        // Save defaults to localStorage
        storage.set('settings', settings.value)
        console.log('Initialized with defaults')
      }
    } catch (err) {
      console.error('Failed to initialize:', err)
      error.value = 'Failed to load settings'
      settings.value = { ...DEFAULT_SETTINGS }
    } finally {
      loading.value = false
    }
  }

  /**
   * Save settings to localStorage
   */
  function save() {
    try {
      storage.set('settings', settings.value)
      console.log('Saved to localStorage:', settings.value)
    } catch (err) {
      console.error('Failed to save:', err)
      error.value = 'Failed to save settings'
    }
  }

  /**
   * Update a single setting
   */
  function updateSetting<K extends keyof UserSettings>(key: K, value: UserSettings[K]) {
    settings.value[key] = value
    save()
  }

  /**
   * Update multiple settings at once
   */
  function updateSettings(newSettings: Partial<UserSettings>) {
    settings.value = { ...settings.value, ...newSettings }
    save()
  }

  /**
   * Reset settings to defaults
   */
  function reset() {
    settings.value = { ...DEFAULT_SETTINGS }
    save()
  }

  /**
   * Watch for changes and auto-save
   */
  watch(
    settings,
    () => {
      save()
    },
    { deep: true }
  )

  return {
    // State
    settings,
    loading,
    error,
    // Actions
    initialize,
    save,
    updateSetting,
    updateSettings,
    reset
  }
})

// Export with store initializer
export const useSettingsStore = useInitializableStore(settingsStoreDefinition)
