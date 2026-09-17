<script setup lang="ts">
/**
 * Self-service account deletion, shown on the account settings tab.
 *
 * Only the account itself is removed — credentials, sessions, profile info.
 * Comments, ratings, library entries and anything else the account
 * contributed elsewhere are deliberately left as they are, now under an
 * anonymized "Deleted account" identity (see `ProfileRepository.deleteAccount`'s
 * own doc comment for the full reasoning). This is not a "erase everything"
 * action, and the confirmation copy says so explicitly so a user is not
 * surprised either way.
 */

import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { Trash2 } from 'lucide-vue-next'
import { profilesApi } from '@/api'
import { useApiError } from '@/composables/useApiError'
import { useLocale } from '@/composables/useLocale'
import { useToast } from '@/composables/useToast'
import { useAuthStore } from '@/store/auth'
import Card from '@/components/ui/Card.vue'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import Modal from '@/components/ui/Modal/Modal.vue'

const router = useRouter()
const { t } = useLocale()
const { translateError } = useApiError()
const toast = useToast()
const authStore = useAuthStore()

const open = ref(false)
const password = ref('')
const submitting = ref(false)
const error = ref<string | null>(null)

function startFlow(): void {
  open.value = true
  password.value = ''
  error.value = null
}

function close(): void {
  if (submitting.value) return
  open.value = false
}

async function submit(): Promise<void> {
  submitting.value = true
  error.value = null

  try {
    await profilesApi.deleteAccount(password.value.trim().length > 0 ? { password: password.value } : {})
    toast.success(t('account.deleteSuccess'))
    open.value = false
    await authStore.logout()
    await router.push({ path: '/' })
  } catch (cause: unknown) {
    error.value = translateError(cause)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <Card variant="glass" class="border border-red-500/20">
    <h2 class="text-lg font-semibold text-red-400 mb-1">{{ t('account.dangerZone') }}</h2>
    <p class="text-sm text-text-secondary mb-4">{{ t('account.deleteHint') }}</p>

    <Button
      variant="ghost"
      size="sm"
      class="text-red-400! hover:bg-red-500/10!"
      @click="startFlow"
    >
      <Trash2 :size="16" />
      {{ t('account.deleteAction') }}
    </Button>

    <Modal :model-value="open" @update:model-value="close">
      <div class="space-y-4 p-2">
        <h3 class="text-xl font-semibold text-text-primary">{{ t('account.deleteConfirmTitle') }}</h3>

        <p class="text-sm text-text-secondary">{{ t('account.deleteConfirmMessage') }}</p>

        <div>
          <label class="block text-sm text-text-secondary mb-1">{{ t('auth.password') }}</label>
          <Input
            v-model="password"
            type="password"
            variant="glass"
            :placeholder="t('account.deletePasswordHint')"
            autocomplete="current-password"
          />
        </div>

        <p v-if="error" class="text-sm text-red-400">{{ error }}</p>

        <div class="flex justify-end gap-2 pt-2">
          <Button variant="ghost" :disabled="submitting" @click="close">
            {{ t('common.cancel') }}
          </Button>
          <Button
            variant="ghost"
            class="text-red-400! hover:bg-red-500/10!"
            :disabled="submitting"
            @click="submit"
          >
            {{ submitting ? t('common.saving') : t('account.deleteAction') }}
          </Button>
        </div>
      </div>
    </Modal>
  </Card>
</template>
