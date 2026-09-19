<script setup lang="ts">
/**
 * Cloudflare Turnstile widget.
 *
 * Renders Cloudflare's managed widget (checkbox shown only when Cloudflare's
 * risk assessment decides to show one; otherwise invisible) and emits the
 * response token for the parent form to send as `turnstileToken`. The token
 * is single-use and expires after 5 minutes server-side, so this also
 * listens for expiry and resets itself rather than leaving a stale token a
 * submit would silently fail against.
 *
 * The `render=explicit` script param plus `window.turnstile.render` (rather
 * than a declarative `<div class="cf-turnstile" data-sitekey="...">`) is
 * used because this app is an SPA: the widget needs to mount/unmount with
 * its Vue component instance, and Cloudflare's implicit auto-render only
 * scans the DOM once on script load.
 */

import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useLocale } from '@/composables/useLocale'

const props = defineProps<{
  /** Disambiguates widgets when more than one could theoretically be live (defensive; this app never renders two at once). */
  action?: string
}>()

const emit = defineEmits<{
  verified: [token: string]
  expired: []
  error: []
}>()

const { locale, t } = useLocale()

const container = ref<HTMLDivElement | null>(null)
const loadError = ref(false)
let widgetId: string | null = null

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
const SCRIPT_ID = 'cf-turnstile-script'

let scriptLoadPromise: Promise<void> | null = null

/** Loads Cloudflare's script at most once, even across multiple widget instances on the same page. */
function loadTurnstileScript(): Promise<void> {
  if (window.turnstile !== undefined) return Promise.resolve()

  scriptLoadPromise ??= new Promise<void>((resolve, reject) => {
    const existing = document.getElementById(SCRIPT_ID)
    if (existing !== null) {
      existing.addEventListener('load', () => resolve())
      existing.addEventListener('error', () => reject(new Error('Turnstile script failed to load')))
      return
    }

    const script = document.createElement('script')
    script.id = SCRIPT_ID
    script.src = SCRIPT_URL
    script.async = true
    script.defer = true
    script.addEventListener('load', () => resolve())
    script.addEventListener('error', () => reject(new Error('Turnstile script failed to load')))
    document.head.appendChild(script)
  })

  return scriptLoadPromise
}

onMounted(async () => {
  try {
    await loadTurnstileScript()
  } catch {
    loadError.value = true
    emit('error')
    return
  }

  if (container.value === null || window.turnstile === undefined) return

  widgetId = window.turnstile.render(container.value, {
    sitekey: import.meta.env.VITE_TURNSTILE_SITE_KEY,
    action: props.action,
    language: locale.value,
    callback: (token: string) => emit('verified', token),
    'expired-callback': () => emit('expired'),
    'error-callback': () => emit('error')
  })
})

onBeforeUnmount(() => {
  if (widgetId !== null) window.turnstile?.remove(widgetId)
})

/** Exposed so a parent can force a fresh token after a failed submit — a used token cannot be replayed. */
function reset(): void {
  if (widgetId !== null) window.turnstile?.reset(widgetId)
}

defineExpose({ reset })
</script>

<template>
  <div>
    <div ref="container" />
    <p v-if="loadError" class="mt-1 text-sm text-red-300">{{ t('errors.turnstileNotLoaded') }}</p>
  </div>
</template>
