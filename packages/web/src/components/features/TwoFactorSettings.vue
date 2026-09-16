<script setup lang="ts">
/**
 * Two-factor authentication settings, on the viewer's own profile.
 *
 * Three states, one at a time: not enabled (an "Enable" button), mid-setup
 * (QR code + a code to confirm it, then recovery codes shown exactly once),
 * or enabled (status + a password-gated "Disable"). Nothing here ever shows
 * the secret or a recovery code a second time — confirming setup is the only
 * moment they exist in the response at all.
 */

import { onMounted, ref } from 'vue'
import QRCode from 'qrcode'
import { KeyRound, ShieldCheck, ShieldOff } from 'lucide-vue-next'
import { authApi } from '@/api'
import { useApiError } from '@/composables/useApiError'
import { useConfirm } from '@/composables/useConfirm'
import { useLocale } from '@/composables/useLocale'
import { useToast } from '@/composables/useToast'
import Card from '@/components/ui/Card.vue'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'

type Stage = 'idle' | 'scanning' | 'confirming' | 'recovery-codes'

const { t } = useLocale()
const { translateError } = useApiError()
const { confirm } = useConfirm()
const toast = useToast()

const loading = ref(true)
const enabled = ref(false)
const recoveryCodesRemaining = ref(0)

const stage = ref<Stage>('idle')
const qrDataUrl = ref('')
const manualKey = ref('')
const confirmCode = ref('')
const recoveryCodes = ref<string[]>([])
const disablePassword = ref('')
const showDisableForm = ref(false)
const busy = ref(false)

async function loadStatus(): Promise<void> {
  loading.value = true
  try {
    const status = await authApi.twoFactorStatus()
    enabled.value = status.enabled
    recoveryCodesRemaining.value = status.recoveryCodesRemaining
  } catch (cause: unknown) {
    toast.error(translateError(cause))
  } finally {
    loading.value = false
  }
}

onMounted(loadStatus)

async function startSetup(): Promise<void> {
  busy.value = true
  try {
    const setup = await authApi.startTwoFactorSetup()
    manualKey.value = setup.secret
    qrDataUrl.value = await QRCode.toDataURL(setup.otpauthUri, { width: 240, margin: 1 })
    confirmCode.value = ''
    stage.value = 'scanning'
  } catch (cause: unknown) {
    toast.error(translateError(cause) || t('auth.twoFactor.errors.setupFailed'))
  } finally {
    busy.value = false
  }
}

async function confirmSetup(): Promise<void> {
  if (busy.value) return
  busy.value = true

  try {
    const result = await authApi.confirmTwoFactorSetup({ code: confirmCode.value.trim() })
    recoveryCodes.value = result.recoveryCodes
    stage.value = 'recovery-codes'
    enabled.value = true
  } catch (cause: unknown) {
    toast.error(translateError(cause) || t('auth.twoFactor.errors.invalidCode'))
  } finally {
    busy.value = false
  }
}

async function finishRecoveryCodes(): Promise<void> {
  stage.value = 'idle'
  qrDataUrl.value = ''
  manualKey.value = ''
  recoveryCodes.value = []
  toast.success(t('auth.twoFactor.success.enabled'))
  await loadStatus()
}

function cancelSetup(): void {
  stage.value = 'idle'
  qrDataUrl.value = ''
  manualKey.value = ''
  confirmCode.value = ''
}

async function disable(): Promise<void> {
  if (busy.value) return

  const confirmed = await confirm({
    title: t('auth.twoFactor.disableConfirmTitle'),
    message: t('auth.twoFactor.disablePasswordPrompt'),
    confirmText: t('auth.twoFactor.disable'),
    cancelText: t('common.cancel'),
    confirmVariant: 'danger'
  })
  if (!confirmed) return

  showDisableForm.value = true
}

async function submitDisable(): Promise<void> {
  if (busy.value) return
  busy.value = true

  try {
    await authApi.disableTwoFactor({ password: disablePassword.value })
    disablePassword.value = ''
    showDisableForm.value = false
    toast.success(t('auth.twoFactor.success.disabled'))
    await loadStatus()
  } catch (cause: unknown) {
    toast.error(translateError(cause))
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <Card variant="glass" class="mb-6">
    <div class="flex items-center gap-3 mb-1">
      <component :is="enabled ? ShieldCheck : ShieldOff" :size="22" :class="enabled ? 'text-accent-cyan' : 'text-text-muted'" />
      <h2 class="text-2xl font-semibold text-text-primary">{{ t('auth.twoFactor.title') }}</h2>
    </div>
    <p class="text-text-secondary text-sm mb-4">{{ t('auth.twoFactor.description') }}</p>

    <div v-if="loading" class="h-12 rounded-lg bg-white/10 animate-pulse" />

    <!-- Enabled, idle -->
    <template v-else-if="stage === 'idle' && enabled">
      <div class="flex items-center justify-between gap-4 glass-light rounded-lg p-4 mb-3">
        <div>
          <p class="text-text-primary font-medium">{{ t('auth.twoFactor.enabled') }}</p>
          <p class="text-xs text-text-muted mt-1">
            {{ t('auth.twoFactor.recoveryCodesRemaining', { count: recoveryCodesRemaining }) }}
          </p>
        </div>
        <Button variant="ghost" size="sm" :disabled="busy" @click="disable">
          {{ t('auth.twoFactor.disable') }}
        </Button>
      </div>

      <form v-if="showDisableForm" class="flex gap-2" @submit.prevent="submitDisable">
        <Input
          v-model="disablePassword"
          type="password"
          :placeholder="t('auth.password')"
          variant="glass"
          autocomplete="current-password"
          class="flex-1"
        />
        <Button type="submit" variant="ghost" size="sm" class="text-red-400" :disabled="busy">
          {{ t('common.confirm') }}
        </Button>
      </form>
    </template>

    <!-- Not enabled, idle -->
    <div v-else-if="stage === 'idle'" class="flex items-center justify-between gap-4 glass-light rounded-lg p-4">
      <p class="text-text-secondary text-sm">{{ t('auth.twoFactor.disabled') }}</p>
      <Button variant="primary" size="sm" :disabled="busy" @click="startSetup">
        {{ t('auth.twoFactor.enable') }}
      </Button>
    </div>

    <!-- Scanning: QR code + confirm code -->
    <div v-else-if="stage === 'scanning'" class="space-y-4">
      <p class="text-text-secondary text-sm">{{ t('auth.twoFactor.setupInstructions') }}</p>

      <div class="flex justify-center">
        <img v-if="qrDataUrl" :src="qrDataUrl" alt="" class="rounded-lg bg-white p-3" width="240" height="240" />
      </div>

      <p class="text-xs text-text-muted text-center">{{ t('auth.twoFactor.manualKey') }}</p>
      <p class="text-sm text-text-primary font-mono text-center break-all glass-light rounded-lg p-2">
        {{ manualKey }}
      </p>

      <p class="text-text-secondary text-sm">{{ t('auth.twoFactor.confirmInstructions') }}</p>

      <form class="flex gap-2" @submit.prevent="confirmSetup">
        <div class="relative flex-1">
          <KeyRound :size="18" class="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <Input
            v-model="confirmCode"
            type="text"
            inputmode="numeric"
            :placeholder="t('auth.twoFactor.codePlaceholder')"
            variant="glass"
            class="pl-10"
            autofocus
          />
        </div>
        <Button type="submit" variant="primary" size="sm" :disabled="busy">
          {{ t('auth.twoFactor.confirm') }}
        </Button>
      </form>

      <button
        type="button"
        class="text-sm text-text-muted hover:text-text-secondary transition-colors"
        @click="cancelSetup"
      >
        {{ t('common.cancel') }}
      </button>
    </div>

    <!-- Recovery codes, shown once -->
    <div v-else-if="stage === 'recovery-codes'" class="space-y-4">
      <h3 class="text-lg font-semibold text-text-primary">{{ t('auth.twoFactor.recoveryCodesTitle') }}</h3>
      <p class="text-text-secondary text-sm">{{ t('auth.twoFactor.recoveryCodesDescription') }}</p>

      <div class="grid grid-cols-2 gap-2 glass-light rounded-lg p-4 font-mono text-sm">
        <span v-for="code in recoveryCodes" :key="code" class="text-text-primary">{{ code }}</span>
      </div>

      <Button variant="primary" class="w-full" @click="finishRecoveryCodes">
        {{ t('auth.twoFactor.recoveryCodesConfirm') }}
      </Button>
    </div>
  </Card>
</template>
