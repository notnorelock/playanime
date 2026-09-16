/**
 * Localization Module
 * Initializes the custom localization system
 * @module modules/localization
 */

import type { App } from 'vue'
import { useLocalization, type Locale } from '@/store/localization'

/**
 * Flatten nested object into dot notation keys
 * Example: { common: { appName: "App" } } => { "common.appName": "App" }
 */
export function flattenObject(...sources: any[]): Record<string, string> {
  const result: Record<string, string> = {}

  const flatten = (obj: any, prefix = ''): void => {
    if (obj == null) return

    for (const key in obj) {
      if (!Object.prototype.hasOwnProperty.call(obj, key)) continue
      const value = obj[key]
      const newKey = prefix ? `${prefix}.${key}` : key

      if (Array.isArray(value)) {
        value.forEach((v, i) => flatten(v, `${newKey}.${i}`))
      } else if (typeof value === 'object' && value !== null) {
        flatten(value, newKey)
      } else {
        result[newKey] = String(value)
      }
    }
  }

  for (const src of sources) flatten(src)

  return result
}

/**
 * Load locale data from JSON files
 */
async function loadLocaleData(code: string): Promise<Record<string, string>> {
  try {
    const module = await import(`../locales/${code}.json`)
    const data = module.default || module

    // Flatten nested structure to support dot notation (e.g., "common.appName")
    return flattenObject(data)
  } catch (error) {
    console.error(`[Localization] Failed to load locale ${code}:`, error)
    return {}
  }
}

/**
 * Setup localization module
 */
export async function setupLocalization(_app: App) {
  console.log('[Localization] Setting up localization...')

  const localizationStore = useLocalization()

  // Load all available locales
  const [enData, plData] = await Promise.all([
    loadLocaleData('en'),
    loadLocaleData('pl')
  ])

  const locales: Locale[] = [
    {
      code: 'en',
      name: 'English',
      data: enData,
      rtl: false
    },
    {
      code: 'pl',
      name: 'Polski',
      data: plData,
      rtl: false
    }
  ]

  // Initialize the localization store
  localizationStore.init(locales, 'en')

  // Update HTML lang and dir attributes
  const htmlEl = document.querySelector('html')
  if (htmlEl) {
    htmlEl.setAttribute('lang', localizationStore.currentLocale.code)
    htmlEl.setAttribute('dir', localizationStore.dir)
  }

  console.log('[Localization] Initialized with locale:', localizationStore.currentLocale.code)

  return localizationStore
}
