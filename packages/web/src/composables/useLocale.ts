/**
 * useLocale Composable
 * Replacement for vue-i18n's useI18n()
 */

import { computed } from 'vue'
import { useLocalization, type SupportedLocale } from '@/store/localization'

export function useLocale() {
  const localizationStore = useLocalization()

  // Get the current locale
  const locale = computed({
    get: () => localizationStore.currentLocale.code as SupportedLocale,
    set: (value: SupportedLocale) => localizationStore.setLocale(value)
  })

  // Translation function
  const t = (key: string, ...args: (string | number | Record<string, any>)[]) => {
    return localizationStore.t(key, ...args)
  }

  // Raw translation without formatting
  const tRaw = (key: string) => {
    return localizationStore.tRaw(key)
  }

  // Plural translation
  const tPlural = (key: string, value: number | string, ...args: (string | number)[]) => {
    return localizationStore.tPlural(key, value, ...args)
  }

  // Translation with args from string
  const tArgsFromStr = (key: string) => {
    return localizationStore.tArgsFromStr(key)
  }

  // Translation with args and context
  const tArgsFromStrCtx = (key: string) => {
    return localizationStore.tArgsFromStrCtx(key)
  }

  return {
    locale,
    t,
    tRaw,
    tPlural,
    tArgsFromStr,
    tArgsFromStrCtx
  }
}
