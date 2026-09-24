<script setup lang="ts">
/**
 * Display name, bio and pronouns, editable in place on the viewer's own
 * profile. Username and email are not here — those go through their own
 * verification flows and are not part of this form.
 */

import { onBeforeUnmount, ref, watch } from 'vue'
import { History, Link2, Loader2, Pencil, Upload } from 'lucide-vue-next'
import type { PublicProfile } from '@playanime/contracts'
import { mediaApi, profilesApi } from '@/api'
import { useApiError } from '@/composables/useApiError'
import { useLocale } from '@/composables/useLocale'
import { useToast } from '@/composables/useToast'
import { useAuthStore } from '@/store/auth'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import Textarea from '@/components/ui/Textarea.vue'
import AvatarCropperModal from './AvatarCropperModal.vue'
import AvatarHistoryModal from './AvatarHistoryModal.vue'

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
/* Avatar — direct actions, not part of the pending edit form above: there    */
/* is no "cancel" state that makes sense for a file picker, so cropping/      */
/* uploading/activating/setting an external URL all take effect immediately   */
/* rather than waiting on the Save button.                                    */
/* -------------------------------------------------------------------------- */

const avatarInput = ref<HTMLInputElement | null>(null)
const uploadingAvatar = ref(false)

const cropperOpen = ref(false)
const cropperImageSrc = ref<string | null>(null)
let cropperObjectUrl: string | null = null

const historyOpen = ref(false)

const showExternalUrlInput = ref(false)
const externalUrl = ref('')
const savingExternalUrl = ref(false)

function pickAvatar(): void {
  avatarInput.value?.click()
}

function onAvatarSelected(event: Event): void {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return

  if (cropperObjectUrl !== null) URL.revokeObjectURL(cropperObjectUrl)
  cropperObjectUrl = URL.createObjectURL(file)
  cropperImageSrc.value = cropperObjectUrl
  cropperOpen.value = true
}

async function applyUpload(profile: PublicProfile): Promise<void> {
  emit('updated', profile)
  // The sidebar/header avatar reads from the session (authStore.user), a
  // separate copy of the same data fetched once at login — without this,
  // the profile page shows the new avatar but everywhere else keeps
  // showing the old one until the next full page load.
  await authStore.resolve(true)
  toast.success(t('profile.edit.avatarSaved'))
}

async function onCropped(file: File): Promise<void> {
  cropperOpen.value = false
  uploadingAvatar.value = true

  try {
    await mediaApi.uploadAvatar(file)
    // The upload endpoint already activates the result — re-fetch the
    // profile so this form's own `avatar`/`banner` fields reflect it,
    // rather than trying to reconstruct PublicProfile from the upload
    // response (which only carries avatar-specific fields).
    const updated = await profilesApi.me()
    await applyUpload(updated)
  } catch (cause: unknown) {
    toast.error(translateError(cause))
  } finally {
    uploadingAvatar.value = false
  }
}

function openHistory(): void {
  historyOpen.value = true
}

async function onHistoryActivated(): Promise<void> {
  try {
    const updated = await profilesApi.me()
    await applyUpload(updated)
  } catch (cause: unknown) {
    toast.error(translateError(cause))
  }
}

function toggleExternalUrlInput(): void {
  showExternalUrlInput.value = !showExternalUrlInput.value
  if (showExternalUrlInput.value) externalUrl.value = props.profile.avatar ?? ''
}

async function saveExternalUrl(): Promise<void> {
  if (savingExternalUrl.value) return
  const trimmed = externalUrl.value.trim()
  savingExternalUrl.value = true

  try {
    const updated = await profilesApi.update({ avatar: trimmed.length === 0 ? null : trimmed })
    emit('updated', updated)
    await authStore.resolve(true)
    showExternalUrlInput.value = false
    toast.success(t('profile.edit.avatarSaved'))
  } catch (cause: unknown) {
    toast.error(translateError(cause))
  } finally {
    savingExternalUrl.value = false
  }
}

onBeforeUnmount(() => {
  if (cropperObjectUrl !== null) URL.revokeObjectURL(cropperObjectUrl)
})
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

    <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5 mb-2">
      <button
        type="button"
        class="flex items-center gap-1.5 text-sm text-text-secondary hover:text-primary transition-colors"
        :disabled="uploadingAvatar"
        @click="pickAvatar"
      >
        <Loader2 v-if="uploadingAvatar" :size="14" class="animate-spin" />
        <Upload v-else :size="14" />
        {{ uploadingAvatar ? t('common.saving') : t('profile.edit.changeAvatar') }}
      </button>

      <button
        type="button"
        class="flex items-center gap-1.5 text-sm text-text-secondary hover:text-primary transition-colors"
        @click="openHistory"
      >
        <History :size="14" />
        {{ t('profile.edit.viewHistory') }}
      </button>

      <button
        type="button"
        class="flex items-center gap-1.5 text-sm text-text-secondary hover:text-primary transition-colors"
        @click="toggleExternalUrlInput"
      >
        <Link2 :size="14" />
        {{ t('profile.edit.useExternalUrl') }}
      </button>
    </div>

    <div v-if="showExternalUrlInput" class="flex gap-2 mb-3">
      <Input
        v-model="externalUrl"
        type="url"
        :placeholder="t('profile.edit.externalUrlPlaceholder')"
        variant="glass"
        :maxlength="2048"
        class="flex-1"
      />
      <Button variant="primary" size="sm" :disabled="savingExternalUrl" @click="saveExternalUrl">
        {{ savingExternalUrl ? t('common.saving') : t('common.save') }}
      </Button>
    </div>

    <AvatarCropperModal
      v-if="cropperImageSrc"
      v-model="cropperOpen"
      :image-src="cropperImageSrc"
      @cropped="onCropped"
    />
    <AvatarHistoryModal v-model="historyOpen" @activated="onHistoryActivated" />

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
