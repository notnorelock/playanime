<script setup lang="ts">
/**
 * Settings Form Component
 * Form for application settings (theme, language, etc)
 */

import { ref, watch } from 'vue'
import { type SupportedLocale } from '@/store/localization'
import { useSettingsStore } from '@/store/settings'
import { useLocale } from '@/composables/useLocale'
import { useToast } from '@/composables/useToast'
import Card from '@/components/ui/Card.vue'
import Button from '@/components/ui/Button.vue'
import Select from '@/components/ui/Select.vue'

const { t, locale } = useLocale()
const settingsStore = useSettingsStore()
const toast = useToast()

// Create reactive local state from store
const selectedLanguage = ref(settingsStore.settings.language)
const autoplayEnabled = ref(settingsStore.settings.autoplay)
const selectedVideoQuality = ref(settingsStore.settings.videoQuality)
const notificationsEnabled = ref(settingsStore.settings.notifications)

const isSaving = ref(false)

// Check if settings have changed
const hasChanges = ref(false)

// Watch for changes
watch(
  [selectedLanguage, autoplayEnabled, selectedVideoQuality, notificationsEnabled],
  () => {
    hasChanges.value =
      selectedLanguage.value !== settingsStore.settings.language ||
      autoplayEnabled.value !== settingsStore.settings.autoplay ||
      selectedVideoQuality.value !== settingsStore.settings.videoQuality ||
      notificationsEnabled.value !== settingsStore.settings.notifications
  }
)

const saveSettings = async () => {
  if (isSaving.value) return

  try {
    isSaving.value = true

    // Update all settings in store first
    settingsStore.updateSettings({
      language: selectedLanguage.value as SupportedLocale,
      autoplay: autoplayEnabled.value,
      videoQuality: selectedVideoQuality.value,
      notifications: notificationsEnabled.value
    })

    // Update language if changed
    if (selectedLanguage.value !== locale.value) {
      // Update locale (this will trigger the localization store)
      locale.value = selectedLanguage.value as SupportedLocale

      console.log(`[Settings] Language changed to: ${selectedLanguage.value}`)
    }

    hasChanges.value = false
    toast.success(t('settings.saved'))
  } catch (error) {
    console.error('Failed to save:', error)
    toast.error(t('settings.saveFailed'))
  } finally {
    isSaving.value = false
  }
}

const resetSettings = () => {
  selectedLanguage.value = settingsStore.settings.language
  autoplayEnabled.value = settingsStore.settings.autoplay
  selectedVideoQuality.value = settingsStore.settings.videoQuality
  notificationsEnabled.value = settingsStore.settings.notifications
  hasChanges.value = false
}
</script>

<template>
  <div class="settings-form max-w-4xl">
    <!-- Appearance Settings -->
    <Card variant="glass" class="mb-6">
      <h2 class="text-2xl font-semibold text-text-primary mb-4">{{ t('settings.appearance') }}</h2>

      <div class="space-y-4">
        <!-- Language Selection -->
        <div>
          <label class="block text-text-secondary mb-2">{{ t('settings.language') }}</label>
          <Select
            v-model="selectedLanguage"
            :options="[
              { label: 'English', value: 'en' },
              { label: 'Polski', value: 'pl' }
            ]"
          />
        </div>

        
      </div>
    </Card>

    <!-- Video Settings -->
    <Card variant="glass" class="mb-6">
      <h2 class="text-2xl font-semibold text-text-primary mb-4">{{ t('settings.video') }}</h2>

      <div class="space-y-4">
        <!-- Autoplay -->
        <div class="flex items-center justify-between">
          <label class="text-text-secondary">{{ t('settings.autoplay') }}</label>
          <input
            v-model="autoplayEnabled"
            type="checkbox"
            class="w-12 h-6 rounded-full appearance-none cursor-pointer transition-colors"
            :class="autoplayEnabled ? 'bg-primary' : 'bg-glass-medium'"
          />
        </div>

        <!-- Video Quality -->
        <div>
          <label class="block text-text-secondary mb-2">{{ t('settings.videoQuality') }}</label>
          <Select
            v-model="selectedVideoQuality"
            :options="[
              { label: t('settings.qualityAuto'), value: 'auto' },
              { label: '1080p', value: '1080p' },
              { label: '720p', value: '720p' },
              { label: '480p', value: '480p' },
              { label: '360p', value: '360p' }
            ]"
          />
        </div>
      </div>
    </Card>

    <!-- Notifications Settings -->
    <Card variant="glass" class="mb-6">
      <h2 class="text-2xl font-semibold text-text-primary mb-4">{{ t('settings.notifications') }}</h2>

      <div class="space-y-4">
        <div class="flex items-center justify-between">
          <label class="text-text-secondary">{{ t('settings.enableNotifications') }}</label>
          <input
            v-model="notificationsEnabled"
            type="checkbox"
            class="w-12 h-6 rounded-full appearance-none cursor-pointer transition-colors"
            :class="notificationsEnabled ? 'bg-primary' : 'bg-glass-medium'"
          />
        </div>
      </div>
    </Card>

    <!-- Action Buttons -->
    <div class="flex gap-4">
      <Button
        variant="primary"
        size="lg"
        class="flex-1"
        @click="saveSettings"
        :disabled="isSaving || !hasChanges"
      >
        {{ isSaving ? t('common.saving') : t('settings.saveSettings') }}
      </Button>

      <Button
        variant="secondary"
        size="lg"
        @click="resetSettings"
        :disabled="!hasChanges"
      >
        {{ t('common.cancel') }}
      </Button>
    </div>
  </div>
</template>
