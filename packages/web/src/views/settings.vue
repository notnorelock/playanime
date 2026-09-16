<script setup lang="ts">
import { useLocale } from '@/composables/useLocale'
import { usePageTitle } from '@/composables/usePageTitle'
import SettingsForm from '@/components/features/SettingsForm.vue'
import { Settings } from 'lucide-vue-next'

definePage({
  meta: {
    icon: Settings,
    label: 'nav.settings',
    showInNav: true,
    order: 91
  }
})

const { t } = useLocale()

// Set page title
usePageTitle(() => t('pageTitle.settings'))
</script>

<template>
  <div class="settings container mx-auto px-4 py-8">
    <h1 class="text-4xl font-bold text-text-primary mb-8">{{ t('settings.title') }}</h1>

    <SettingsForm />
  </div>
</template>
