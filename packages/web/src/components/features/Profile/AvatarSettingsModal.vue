<script setup lang="ts">
/**
 * Every avatar control in one place — replaces what used to be three
 * separate, easy-to-miss links (upload, history, external URL) with one
 * "Avatar" entry point and a tabbed modal. Upload's crop step happens
 * inline within the Upload tab rather than as a second nested modal, so
 * opening this component is always exactly one modal deep.
 */

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Cropper, CircleStencil } from 'vue-advanced-cropper'
import 'vue-advanced-cropper/dist/style.css'
import { Check, Trash2, Upload as UploadIcon } from 'lucide-vue-next'
import type { AvatarHistoryItem, PublicProfile } from '@playanime/contracts'
import { mediaApi, profilesApi } from '@/api'
import { useApiError } from '@/composables/useApiError'
import { useConfirm } from '@/composables/useConfirm'
import { useLocale } from '@/composables/useLocale'
import { useToast } from '@/composables/useToast'
import { useAuthStore } from '@/store/auth'
import Modal from '@/components/ui/Modal/Modal.vue'
import Card from '@/components/ui/Card.vue'
import Input from '@/components/ui/Input.vue'
import Button from '@/components/ui/Button.vue'

const props = defineProps<{
  modelValue: boolean
  currentAvatarUrl: string | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  updated: [profile: PublicProfile]
}>()

const { t } = useLocale()
const { translateError } = useApiError()
const { confirm } = useConfirm()
const toast = useToast()
const authStore = useAuthStore()

type Tab = 'upload' | 'history' | 'externalUrl'
const activeTab = ref<Tab>('upload')

const tabs = computed(() => [
  { id: 'upload' as const, label: t('profile.edit.tabUpload') },
  { id: 'history' as const, label: t('profile.edit.tabHistory') },
  { id: 'externalUrl' as const, label: t('profile.edit.tabExternalUrl') }
])

function close(): void {
  emit('update:modelValue', false)
}

async function applyChange(profile: PublicProfile): Promise<void> {
  emit('updated', profile)
  // The sidebar/header avatar reads from the session (authStore.user), a
  // separate copy of the same data fetched once at login — without this,
  // it shows the new avatar here but keeps the old one everywhere else
  // until the next full page load.
  await authStore.resolve(true)
  toast.success(t('profile.edit.avatarSaved'))
}

/* -------------------------------------------------------------------------- */
/* Upload — file picker, then an inline crop step, then the actual upload      */
/* -------------------------------------------------------------------------- */

const avatarInput = ref<HTMLInputElement | null>(null)
const uploadingAvatar = ref(false)

const cropperImageSrc = ref<string | null>(null)
let cropperObjectUrl: string | null = null
const cropper = ref<InstanceType<typeof Cropper> | null>(null)
const exportingCrop = ref(false)

/** Larger than the biggest server-generated size (512) so downscaling on the server never upscales. */
const EXPORT_SIZE = 1024

function pickAvatar(): void {
  avatarInput.value?.click()
}

/** Shared by the file input and drag-and-drop — either way, a picked file goes straight into the cropper, never uploaded raw. */
function loadFileIntoCropper(file: File): void {
  if (cropperObjectUrl !== null) URL.revokeObjectURL(cropperObjectUrl)
  cropperObjectUrl = URL.createObjectURL(file)
  cropperImageSrc.value = cropperObjectUrl
}

function onAvatarSelected(event: Event): void {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  loadFileIntoCropper(file)
}

const isDraggingOver = ref(false)

function onDragOver(event: DragEvent): void {
  event.preventDefault()
  isDraggingOver.value = true
}

function onDragLeave(): void {
  isDraggingOver.value = false
}

function onDrop(event: DragEvent): void {
  event.preventDefault()
  isDraggingOver.value = false

  const file = event.dataTransfer?.files[0]
  if (file === undefined || !file.type.startsWith('image/')) return
  loadFileIntoCropper(file)
}

function cancelCrop(): void {
  if (cropperObjectUrl !== null) URL.revokeObjectURL(cropperObjectUrl)
  cropperObjectUrl = null
  cropperImageSrc.value = null
}

async function applyCrop(): Promise<void> {
  const instance = cropper.value
  if (instance === null || exportingCrop.value) return

  const result = instance.getResult()
  if (!result.canvas) return

  exportingCrop.value = true

  try {
    const blob = await new Promise<Blob | null>((resolve) => {
      result.canvas?.toBlob(resolve, 'image/png')
    })
    if (blob === null) return

    await uploadCroppedFile(new File([blob], 'avatar.png', { type: 'image/png' }))
    cancelCrop()
  } finally {
    exportingCrop.value = false
  }
}

async function uploadCroppedFile(file: File): Promise<void> {
  uploadingAvatar.value = true

  try {
    await mediaApi.uploadAvatar(file)
    // The upload endpoint already activates the result — re-fetch the
    // profile so the caller's own `avatar` field reflects it, rather than
    // trying to reconstruct PublicProfile from the upload response (which
    // only carries avatar-specific fields).
    const updated = await profilesApi.me()
    await applyChange(updated)
    if (activeTab.value === 'upload') await loadHistory()
  } catch (cause: unknown) {
    toast.error(translateError(cause))
  } finally {
    uploadingAvatar.value = false
  }
}

/* -------------------------------------------------------------------------- */
/* History                                                                     */
/* -------------------------------------------------------------------------- */

const historyItems = ref<AvatarHistoryItem[]>([])
const historyLoading = ref(true)
const historyBusyId = ref<string | null>(null)

async function loadHistory(): Promise<void> {
  historyLoading.value = true
  try {
    historyItems.value = (await mediaApi.getAvatarHistory()).items
  } catch (cause: unknown) {
    toast.error(translateError(cause))
  } finally {
    historyLoading.value = false
  }
}

async function activateHistoryItem(item: AvatarHistoryItem): Promise<void> {
  if (historyBusyId.value !== null || item.isActive) return
  historyBusyId.value = item.id

  try {
    const updated = await mediaApi.activateAvatar(item.id)
    historyItems.value = historyItems.value.map((entry) => ({ ...entry, isActive: entry.id === updated.id }))
    const profile = await profilesApi.me()
    await applyChange(profile)
  } catch (cause: unknown) {
    toast.error(translateError(cause))
  } finally {
    historyBusyId.value = null
  }
}

async function removeHistoryItem(item: AvatarHistoryItem): Promise<void> {
  if (historyBusyId.value !== null) return

  const confirmed = await confirm({
    message: t('profile.edit.deleteAvatarConfirm'),
    confirmText: t('common.delete'),
    cancelText: t('common.cancel'),
    confirmVariant: 'danger'
  })
  if (!confirmed) return

  historyBusyId.value = item.id

  try {
    await mediaApi.deleteAvatarUpload(item.id)
    historyItems.value = historyItems.value.filter((entry) => entry.id !== item.id)
    toast.success(t('profile.edit.avatarDeleted'))
  } catch (cause: unknown) {
    toast.error(translateError(cause))
  } finally {
    historyBusyId.value = null
  }
}

/* -------------------------------------------------------------------------- */
/* External URL                                                                */
/* -------------------------------------------------------------------------- */

const externalUrl = ref('')
const savingExternalUrl = ref(false)

async function saveExternalUrl(): Promise<void> {
  if (savingExternalUrl.value) return
  const trimmed = externalUrl.value.trim()
  savingExternalUrl.value = true

  try {
    const updated = await profilesApi.update({ avatar: trimmed.length === 0 ? null : trimmed })
    await applyChange(updated)
  } catch (cause: unknown) {
    toast.error(translateError(cause))
  } finally {
    savingExternalUrl.value = false
  }
}

/* -------------------------------------------------------------------------- */
/* Lifecycle                                                                   */
/* -------------------------------------------------------------------------- */

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    activeTab.value = 'upload'
    externalUrl.value = props.currentAvatarUrl ?? ''
    void loadHistory()
  }
)

onMounted(() => {
  if (props.modelValue) void loadHistory()
})

onBeforeUnmount(() => {
  if (cropperObjectUrl !== null) URL.revokeObjectURL(cropperObjectUrl)
})
</script>

<template>
  <Modal :model-value="modelValue" :title="t('profile.edit.avatarSettingsTitle')" size="lg" @update:model-value="close">
    <div class="space-y-4">
      <div class="glass-medium rounded-lg p-1 inline-flex gap-1 flex-wrap">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          type="button"
          class="px-4 py-2 rounded-md text-sm font-medium transition-smooth"
          :class="[
            activeTab === tab.id
              ? 'bg-primary text-white'
              : 'text-text-secondary hover:text-text-primary hover:bg-white/10'
          ]"
          @click="activeTab = tab.id"
        >
          {{ tab.label }}
        </button>
      </div>

      <!-- Upload -->
      <div v-if="activeTab === 'upload'">
        <input
          ref="avatarInput"
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          class="hidden"
          @change="onAvatarSelected"
        />

        <template v-if="cropperImageSrc">
          <div class="h-80 rounded-lg overflow-hidden bg-dark-900 mb-3">
            <Cropper
              ref="cropper"
              class="h-full w-full"
              :src="cropperImageSrc"
              :stencil-component="CircleStencil"
              :stencil-props="{ aspectRatio: 1 }"
              :canvas="{ width: EXPORT_SIZE, height: EXPORT_SIZE }"
            />
          </div>
          <p class="text-xs text-text-muted mb-3">{{ t('profile.edit.cropHint') }}</p>
          <div class="flex justify-end gap-2">
            <Button variant="ghost" :disabled="exportingCrop" @click="cancelCrop">{{ t('common.cancel') }}</Button>
            <Button variant="primary" :disabled="exportingCrop" @click="applyCrop">
              <Check :size="16" />
              {{ exportingCrop ? t('common.saving') : t('profile.edit.cropApply') }}
            </Button>
          </div>
        </template>

        <template v-else>
          <Card
            variant="glass"
            class="p-8 text-center space-y-3 border-2 border-dashed transition-smooth"
            :class="isDraggingOver ? 'border-primary bg-primary/5' : 'border-transparent'"
            @dragover="onDragOver"
            @dragleave="onDragLeave"
            @drop="onDrop"
          >
            <UploadIcon :size="28" class="mx-auto" :class="isDraggingOver ? 'text-primary' : 'text-text-muted'" />
            <p class="text-sm text-text-secondary">{{ t('profile.edit.uploadHint') }}</p>
            <Button variant="primary" :disabled="uploadingAvatar" @click="pickAvatar">
              <UploadIcon :size="16" />
              {{ uploadingAvatar ? t('common.saving') : t('profile.edit.changeAvatar') }}
            </Button>
          </Card>
        </template>
      </div>

      <!-- History -->
      <div v-else-if="activeTab === 'history'">
        <div v-if="historyLoading" class="grid grid-cols-3 sm:grid-cols-4 gap-3">
          <div v-for="i in 6" :key="i" class="aspect-square rounded-lg bg-white/10 animate-pulse" />
        </div>

        <Card v-else-if="historyItems.length === 0" variant="glass" class="p-8 text-center text-text-secondary">
          {{ t('profile.edit.historyEmpty') }}
        </Card>

        <div v-else class="grid grid-cols-3 sm:grid-cols-4 gap-3">
          <div v-for="item in historyItems" :key="item.id" class="relative group">
            <button
              type="button"
              class="block w-full aspect-square rounded-lg overflow-hidden ring-2 transition-smooth"
              :class="item.isActive ? 'ring-primary' : 'ring-transparent hover:ring-white/20'"
              :disabled="historyBusyId === item.id"
              @click="activateHistoryItem(item)"
            >
              <img :src="item.sizes['128']" :alt="t('profile.edit.historyTitle')" class="w-full h-full object-cover" />
            </button>

            <span v-if="item.isActive" class="absolute top-1 left-1 p-1 rounded-full bg-primary text-white">
              <Check :size="12" />
            </span>

            <button
              type="button"
              class="absolute top-1 right-1 p-1 rounded-full bg-dark-900/80 text-text-secondary opacity-0 group-hover:opacity-100 hover:text-red-400 transition-smooth"
              :disabled="historyBusyId === item.id"
              @click.stop="removeHistoryItem(item)"
            >
              <Trash2 :size="12" />
            </button>
          </div>
        </div>
      </div>

      <!-- External URL -->
      <div v-else class="space-y-3">
        <p class="text-sm text-text-secondary">{{ t('profile.edit.externalUrlHint') }}</p>
        <div class="flex gap-2">
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
      </div>
    </div>
  </Modal>
</template>
