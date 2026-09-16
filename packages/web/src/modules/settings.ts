/**
 * Settings Module
 * Applies stored client settings during bootstrap.
 *
 * The previous version waited on `settingsStore.$initStatus`, a property the
 * store does not expose, and then slept 100ms regardless. Both are gone: the
 * store loads synchronously from `localStorage` when it is first used, so
 * reading it after construction is already correct.
 */

import type { App } from 'vue'
import { useSettingsStore } from '@/store/settings'

/** Applies the stored theme to the document root. */
function applyTheme(theme: 'light' | 'dark' | 'auto'): void {
  const root = document.documentElement

  if (theme === 'auto') {
    // Following the OS is the default; an explicit choice overrides it.
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    root.dataset['theme'] = prefersDark ? 'dark' : 'light'
    return
  }

  root.dataset['theme'] = theme
}

export function applySettings(): void {
  const settingsStore = useSettingsStore()
  applyTheme(settingsStore.settings.theme)
}

/**
 * Sets up the settings module.
 *
 * `app` is part of the module contract every bootstrap module shares, even
 * where — as here — nothing is registered on the instance.
 */
export function setupSettings(_app: App): void {
  applySettings()
}
