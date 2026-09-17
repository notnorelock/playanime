<script setup lang="ts">
/**
 * Devices list, shown on the security settings screen.
 *
 * A device is not a session (see `SessionsList`): blocking one here revokes
 * every session tied to it, backend-enforced. Blocking the device the
 * viewer is currently on is refused server-side (`ConflictError`) — the
 * button is disabled for that one card so the confusing round trip never
 * happens, rather than only catching it after the request.
 */

import { computed, onMounted, ref } from 'vue'
import { HelpCircle, Monitor, Smartphone, Tablet, Tv } from 'lucide-vue-next'
import type { DeviceSummary } from '@playanime/contracts'
import { devicesApi } from '@/api'
import { deviceTypeIcon, toDeviceCardModel, type DeviceCardModel } from '@/models/device'
import { useApiError } from '@/composables/useApiError'
import { useConfirm } from '@/composables/useConfirm'
import { useLocale } from '@/composables/useLocale'
import { useToast } from '@/composables/useToast'
import Card from '@/components/ui/Card.vue'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'

const { t, locale } = useLocale()
const { translateError } = useApiError()
const { confirm } = useConfirm()
const toast = useToast()

const DEVICE_ICONS = { Monitor, Smartphone, Tablet, Tv, HelpCircle }

function iconFor(model: DeviceCardModel) {
  return DEVICE_ICONS[deviceTypeIcon(model.deviceType) as keyof typeof DEVICE_ICONS] ?? HelpCircle
}

const devices = ref<DeviceSummary[]>([])
const loading = ref(true)
const busyId = ref<string | null>(null)
const renamingId = ref<string | null>(null)
const renameValue = ref('')

const models = computed<DeviceCardModel[]>(() =>
  devices.value.map((device) => toDeviceCardModel(device, locale.value, t('security.devices.types.unknown')))
)

async function load(): Promise<void> {
  loading.value = true
  try {
    devices.value = await devicesApi.list()
  } catch (cause: unknown) {
    toast.error(translateError(cause))
  } finally {
    loading.value = false
  }
}

onMounted(load)

function startRename(model: DeviceCardModel): void {
  renamingId.value = model.id
  renameValue.value = model.displayName
}

function cancelRename(): void {
  renamingId.value = null
  renameValue.value = ''
}

async function submitRename(id: string): Promise<void> {
  const displayName = renameValue.value.trim()
  if (displayName.length === 0) return

  busyId.value = id
  try {
    await devicesApi.rename(id, displayName)
    renamingId.value = null
    await load()
  } catch (cause: unknown) {
    toast.error(translateError(cause))
  } finally {
    busyId.value = null
  }
}

async function block(model: DeviceCardModel): Promise<void> {
  const confirmed = await confirm({
    message: t('security.devices.confirmBlock'),
    confirmText: t('security.devices.block'),
    cancelText: t('common.cancel'),
    confirmVariant: 'danger'
  })
  if (!confirmed) return

  busyId.value = model.id
  try {
    await devicesApi.block(model.id)
    await load()
  } catch (cause: unknown) {
    toast.error(translateError(cause))
  } finally {
    busyId.value = null
  }
}

async function unblock(model: DeviceCardModel): Promise<void> {
  const confirmed = await confirm({
    message: t('security.devices.confirmUnblock'),
    confirmText: t('security.devices.unblock'),
    cancelText: t('common.cancel')
  })
  if (!confirmed) return

  busyId.value = model.id
  try {
    await devicesApi.unblock(model.id)
    await load()
  } catch (cause: unknown) {
    toast.error(translateError(cause))
  } finally {
    busyId.value = null
  }
}
</script>

<template>
  <Card variant="glass" class="mb-6">
    <h2 class="text-2xl font-semibold text-text-primary mb-4">{{ t('security.devices.title') }}</h2>

    <div v-if="loading" class="space-y-2">
      <div class="h-16 rounded-lg bg-white/10 animate-pulse" />
      <div class="h-16 rounded-lg bg-white/10 animate-pulse" />
    </div>

    <p v-else-if="models.length === 0" class="text-text-muted text-sm">
      {{ t('security.devices.empty') }}
    </p>

    <div v-else class="space-y-2">
      <div v-for="model in models" :key="model.id" class="glass-light rounded-lg p-4">
        <div class="flex items-center justify-between gap-4">
          <div class="flex items-center gap-3 min-w-0">
            <component :is="iconFor(model)" :size="22" class="text-primary shrink-0" />
            <div class="min-w-0">
              <template v-if="renamingId === model.id">
                <form class="flex gap-2" @submit.prevent="submitRename(model.id)">
                  <Input
                    v-model="renameValue"
                    variant="glass"
                    size="sm"
                    :placeholder="t('security.devices.renamePlaceholder')"
                    autofocus
                  />
                  <Button type="submit" variant="primary" size="sm" :disabled="busyId === model.id">
                    {{ t('common.confirm') }}
                  </Button>
                  <Button type="button" variant="ghost" size="sm" @click="cancelRename">
                    {{ t('common.cancel') }}
                  </Button>
                </form>
              </template>
              <template v-else>
                <p class="text-text-primary font-medium flex items-center gap-2 truncate">
                  {{ model.displayName }}
                  <span
                    v-if="model.isCurrent"
                    class="px-2 py-0.5 rounded-md text-xs font-semibold bg-primary/20 text-primary shrink-0"
                  >
                    {{ t('security.devices.thisDevice') }}
                  </span>
                  <span
                    v-if="model.isBlocked"
                    class="px-2 py-0.5 rounded-md text-xs font-semibold bg-red-500/20 text-red-300 shrink-0"
                  >
                    {{ t('security.devices.blocked') }}
                  </span>
                </p>
                <p class="text-xs text-text-muted mt-1">
                  {{ t('security.devices.lastSeen', { time: model.lastSeenLabel }) }}
                  · {{ t('security.devices.activeSessions', { count: model.activeSessionCount }) }}
                </p>
              </template>
            </div>
          </div>

          <div v-if="renamingId !== model.id" class="flex items-center gap-2 shrink-0">
            <Button variant="ghost" size="sm" @click="startRename(model)">
              {{ t('security.devices.rename') }}
            </Button>
            <Button
              v-if="model.isBlocked"
              variant="ghost"
              size="sm"
              :disabled="busyId === model.id"
              @click="unblock(model)"
            >
              {{ t('security.devices.unblock') }}
            </Button>
            <Button
              v-else
              variant="ghost"
              size="sm"
              class="text-red-400"
              :disabled="busyId === model.id || model.isCurrent"
              :title="model.isCurrent ? t('security.devices.cannotBlockCurrent') : undefined"
              @click="block(model)"
            >
              {{ t('security.devices.block') }}
            </Button>
          </div>
        </div>
      </div>
    </div>
  </Card>
</template>
