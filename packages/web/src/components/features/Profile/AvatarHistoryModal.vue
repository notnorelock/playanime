<script setup lang="ts">
/**
 * Browse and manage the caller's own past avatar uploads — every upload is
 * kept until explicitly deleted here (see media.service.ts's own doc
 * comment), so this is the only place history actually shrinks.
 */

import { onMounted, ref, watch } from 'vue'
import { Check, Trash2 } from 'lucide-vue-next'
import type { AvatarHistoryItem } from '@playanime/contracts'
import { mediaApi } from '@/api'
import { useApiError } from '@/composables/useApiError'
import { useConfirm } from '@/composables/useConfirm'
import { useLocale } from '@/composables/useLocale'
import { useToast } from '@/composables/useToast'
import Modal from '@/components/ui/Modal/Modal.vue'
import Card from '@/components/ui/Card.vue'
import Button from '@/components/ui/Button.vue'

const props = defineProps<{
  modelValue: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  activated: [item: AvatarHistoryItem]
}>()

const { t } = useLocale()
const { translateError } = useApiError()
const { confirm } = useConfirm()
const toast = useToast()

const items = ref<AvatarHistoryItem[]>([])
const loading = ref(true)
const busyId = ref<string | null>(null)

async function load(): Promise<void> {
  loading.value = true
  try {
    items.value = (await mediaApi.getAvatarHistory()).items
  } catch (cause: unknown) {
    toast.error(translateError(cause))
  } finally {
    loading.value = false
  }
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) void load()
  }
)

onMounted(() => {
  if (props.modelValue) void load()
})

function close(): void {
  emit('update:modelValue', false)
}

async function activate(item: AvatarHistoryItem): Promise<void> {
  if (busyId.value !== null || item.isActive) return
  busyId.value = item.id

  try {
    const updated = await mediaApi.activateAvatar(item.id)
    items.value = items.value.map((entry) => ({ ...entry, isActive: entry.id === updated.id }))
    emit('activated', { ...item, isActive: true })
    toast.success(t('profile.edit.avatarSaved'))
  } catch (cause: unknown) {
    toast.error(translateError(cause))
  } finally {
    busyId.value = null
  }
}

async function remove(item: AvatarHistoryItem): Promise<void> {
  if (busyId.value !== null) return

  const confirmed = await confirm({
    message: t('profile.edit.deleteAvatarConfirm'),
    confirmText: t('common.delete'),
    cancelText: t('common.cancel'),
    confirmVariant: 'danger'
  })
  if (!confirmed) return

  busyId.value = item.id

  try {
    await mediaApi.deleteAvatarUpload(item.id)
    items.value = items.value.filter((entry) => entry.id !== item.id)
    toast.success(t('profile.edit.avatarDeleted'))
  } catch (cause: unknown) {
    toast.error(translateError(cause))
  } finally {
    busyId.value = null
  }
}
</script>

<template>
  <Modal :model-value="modelValue" :title="t('profile.edit.historyTitle')" size="lg" @update:model-value="close">
    <div v-if="loading" class="grid grid-cols-3 sm:grid-cols-4 gap-3">
      <div v-for="i in 6" :key="i" class="aspect-square rounded-lg bg-white/10 animate-pulse" />
    </div>

    <Card v-else-if="items.length === 0" variant="glass" class="p-8 text-center text-text-secondary">
      {{ t('profile.edit.historyEmpty') }}
    </Card>

    <div v-else class="grid grid-cols-3 sm:grid-cols-4 gap-3">
      <div v-for="item in items" :key="item.id" class="relative group">
        <button
          type="button"
          class="block w-full aspect-square rounded-lg overflow-hidden ring-2 transition-smooth"
          :class="item.isActive ? 'ring-primary' : 'ring-transparent hover:ring-white/20'"
          :disabled="busyId === item.id"
          @click="activate(item)"
        >
          <img :src="item.sizes['128']" :alt="t('profile.edit.historyTitle')" class="w-full h-full object-cover" />
        </button>

        <span
          v-if="item.isActive"
          class="absolute top-1 left-1 p-1 rounded-full bg-primary text-white"
        >
          <Check :size="12" />
        </span>

        <button
          type="button"
          class="absolute top-1 right-1 p-1 rounded-full bg-dark-900/80 text-text-secondary opacity-0 group-hover:opacity-100 hover:text-red-400 transition-smooth"
          :disabled="busyId === item.id"
          @click.stop="remove(item)"
        >
          <Trash2 :size="12" />
        </button>
      </div>
    </div>

    <div class="flex justify-end pt-4">
      <Button variant="ghost" @click="close">{{ t('common.cancel') }}</Button>
    </div>
  </Modal>
</template>
