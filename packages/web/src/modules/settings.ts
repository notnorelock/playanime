/**
 * Settings Module
 * Initializes and applies user settings from store
 * @module modules/settings
 */

import type { App } from 'vue'
import { useSettingsStore } from '@/store/settings'

/**
 * Apply settings to the application
 */
export async function applySettings() {
  const settingsStore = useSettingsStore()

  // Wait for settings to be initialized (if not already)
  if (!settingsStore.$initStatus.isInitialized) {
    console.log('Waiting for settings initialization...')
    // Settings will be loaded automatically by the store initializer
    await new Promise(resolve => setTimeout(resolve, 100))
  }

  console.log('Applying settings:', settingsStore.settings)
}

/**
 * Setup settings module
 * This should be called during app bootstrap
 */
export async function setupSettings(app: App) {
  console.log('Setting up settings module...')

  // Initialize settings store (this will load from localStorage)
  useSettingsStore()

  // Apply settings
  await applySettings()

  console.log('Settings module initialized')
}