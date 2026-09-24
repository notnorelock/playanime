<script setup lang="ts">
/**
 * Display name, bio and pronouns, editable in place on the viewer's own
 * profile. Username and email are not here — those go through their own
 * verification flows and are not part of this form.
 */

import { ref, watch } from 'vue'
import { Loader2, Pencil, Upload } from 'lucide-vue-next'
import type { PublicProfile } from '@playanime/contracts'
import { mediaApi, profilesApi } from '@/api'
import { useApiError } from '@/composables/useApiError'
import { useLocale } from '@/composables/useLocale'
import { useToast } from '@/composables/useToast'
import { useAuthStore } from '@/store/auth'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import Textarea from '@/components/ui/Textarea.vue'

interface Props {
  profile: PublicProfile
}

const props = defineProps<Props>()

const emit = defineEmits<{
  updated: [profile: PublicProfile]
}>()

const { t } = useLocale()
const { translateError } = useApiError()
const toast = useToast()
const authStore = useAuthStore()

const MAX_BIO_LENGTH = 500
const MAX_PRONOUNS_LENGTH = 30

const isEditing = ref(false)
const saving = ref(false)
const displayName = ref('')
const bio = ref('')
const pronouns = ref('')

function resetFromProfile(): void {
  displayName.value = props.profile.displayName ?? ''
  bio.value = props.profile.bio ?? ''
  pronouns.value = props.profile.pronouns ?? ''
}

watch(() => props.profile, resetFromProfile, { immediate: true })

function startEdit(): void {
  resetFromProfile()
  isEditing.value = true
}

function cancel(): void {
  resetFromProfile()
  isEditing.value = false
}

async function save(): Promise<void> {
  if (saving.value) return
  saving.value = true

  try {
    const updated = await profilesApi.update({
      displayName: displayName.value.trim().length === 0 ? null : displayName.value.trim(),
      bio: bio.value.trim().length === 0 ? null : bio.value.trim(),
      pronouns: pronouns.value.trim().length === 0 ? null : pronouns.value.trim()
    })
    emit('updated', updated)
    isEditing.value = false
    toast.success(t('profile.edit.saved'))
  } catch (cause: unknown) {
    toast.error(translateError(cause))
  } finally {
    saving.value = false
  }
}

/* -------------------------------------------------------------------------- */
/* Avatar — a direct upload-and-apply action, not part of the pending edit     */
/* form above: there is no "cancel" state that makes sense for a file picker,  */
/* so picking a new avatar takes effect immediately rather than waiting on the */
/* Save button.                                                                */
/* -------------------------------------------------------------------------- */

const avatarInput = ref<HTMLInputElement | null>(null)
const uploadingAvatar = ref(false)

function pickAvatar(): void {
  avatarInput.value?.click()
}

async function onAvatarSelected(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || uploadingAvatar.value) return

  uploadingAvatar.value = true

  try {
    const { url } = await mediaApi.uploadAvatar(file)
    const updated = await profilesApi.update({ avatar: url })
    emit('updated', updated)
    // The sidebar/header avatar reads from the session (authStore.user), a
    // separate copy of the same data fetched once at login — without this,
    // the profile page shows the new avatar but everywhere else keeps
    // showing the old one until the next full page load.
    await authStore.resolve(true)
    toast.success(t('profile.edit.avatarSaved'))
  } catch (cause: unknown) {
    toast.error(translateError(cause))
  } finally {
    uploadingAvatar.value = false
  }
}
</script>

<template>
  <div>
    <input
      ref="avatarInput"
      type="file"
      accept="image/png,image/jpeg,image/webp,image/gif"
      class="hidden"
      @change="onAvatarSelected"
    />
    <button
      type="button"
      class="flex items-center gap-1.5 text-sm text-text-secondary hover:text-primary transition-colors mb-2"
      :disabled="uploadingAvatar"
      @click="pickAvatar"
    >
      <Loader2 v-if="uploadingAvatar" :size="14" class="animate-spin" />
      <Upload v-else :size="14" />
      {{ uploadingAvatar ? t('common.saving') : t('profile.edit.changeAvatar') }}
    </button>

    <button
      v-if="!isEditing"
      type="button"
      class="flex items-center gap-1.5 text-sm text-text-secondary hover:text-primary transition-colors"
      @click="startEdit"
    >
      <Pencil :size="14" />
      {{ t('profile.edit.action') }}
    </button>

    <form v-else class="space-y-4 mt-3" @submit.prevent="save">
      <div>
        <label for="edit-display-name" class="block text-sm font-medium text-text-primary mb-1.5">
          {{ t('profile.edit.displayName') }}
        </label>
        <Input
          id="edit-display-name"
          v-model="displayName"
          type="text"
          :placeholder="profile.username"
          variant="glass"
          :maxlength="64"
        />
      </div>

      <div>
        <label for="edit-pronouns" class="block text-sm font-medium text-text-primary mb-1.5">
          {{ t('profile.edit.pronouns') }}
        </label>
        <Input
          id="edit-pronouns"
          v-model="pronouns"
          type="text"
          :placeholder="t('profile.edit.pronounsPlaceholder')"
          variant="glass"
          :maxlength="MAX_PRONOUNS_LENGTH"
        />
      </div>

      <div>
        <label for="edit-bio" class="block text-sm font-medium text-text-primary mb-1.5">
          {{ t('profile.edit.bio') }}
        </label>
        <Textarea
          id="edit-bio"
          v-model="bio"
          :placeholder="t('profile.edit.bioPlaceholder')"
          variant="glass"
          :rows="3"
          :maxlength="MAX_BIO_LENGTH"
        />
        <p class="mt-1 text-xs text-text-muted text-right">{{ bio.length }}/{{ MAX_BIO_LENGTH }}</p>
      </div>

      <div class="flex gap-2">
        <Button type="submit" variant="primary" size="sm" :disabled="saving">
          {{ saving ? t('common.saving') : t('common.save') }}
        </Button>
        <Button type="button" variant="ghost" size="sm" :disabled="saving" @click="cancel">
          {{ t('common.cancel') }}
        </Button>
      </div>
    </form>
  </div>
</template>
