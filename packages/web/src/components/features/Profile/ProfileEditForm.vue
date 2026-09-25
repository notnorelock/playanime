<script setup lang="ts">
/**
 * Display name, bio and pronouns, editable in place on the viewer's own
 * profile. Username and email are not here — those go through their own
 * verification flows and are not part of this form.
 */

import { ref, watch } from 'vue'
import { Pencil, Settings } from 'lucide-vue-next'
import type { PublicProfile } from '@playanime/contracts'
import { profilesApi } from '@/api'
import { useApiError } from '@/composables/useApiError'
import { useLocale } from '@/composables/useLocale'
import { useToast } from '@/composables/useToast'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import Textarea from '@/components/ui/Textarea.vue'
import AvatarSettingsModal from './AvatarSettingsModal.vue'

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
/* Avatar — everything (upload, history, external URL) lives in one modal    */
/* now instead of three separate links, so this form only needs to open it.  */
/* -------------------------------------------------------------------------- */

const avatarSettingsOpen = ref(false)

function onAvatarUpdated(profile: PublicProfile): void {
  emit('updated', profile)
}
</script>

<template>
  <div>
    <button
      type="button"
      class="flex items-center gap-1.5 text-sm text-text-secondary hover:text-primary transition-colors mb-2"
      @click="avatarSettingsOpen = true"
    >
      <Settings :size="14" />
      {{ t('profile.edit.avatarSettingsTitle') }}
    </button>

    <AvatarSettingsModal
      v-model="avatarSettingsOpen"
      :current-avatar-url="profile.avatar"
      @updated="onAvatarUpdated"
    />

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
