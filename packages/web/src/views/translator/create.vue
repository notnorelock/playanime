<script setup lang="ts">
/**
 * Create a translator group.
 *
 * The slug is not a field: the server derives it from the name, because letting
 * a client choose one invites squatting on the slugs of well-known groups.
 *
 * Creating a group requires a verified email — a group is a public identity, and
 * one made from a throwaway account is how impersonation starts.
 */

import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Plus } from 'lucide-vue-next'
import { translatorsApi } from '@/api'
import { useApiError } from '@/composables/useApiError'
import { useLocale } from '@/composables/useLocale'
import { usePageTitle } from '@/composables/usePageTitle'
import { useToast } from '@/composables/useToast'
import { useAuthStore } from '@/store/auth'
import Card from '@/components/ui/Card.vue'
import Input from '@/components/ui/Input.vue'
import Textarea from '@/components/ui/Textarea.vue'
import Button from '@/components/ui/Button.vue'

definePage({
  meta: {
    requiresAuth: true
  }
})

const router = useRouter()
const { t } = useLocale()
const { translateError, fieldErrors } = useApiError()
const toast = useToast()
const authStore = useAuthStore()

usePageTitle(() => t('translator.createGroup'))

const name = ref('')
const description = ref('')
const websiteUrl = ref('')
const discordUrl = ref('')
const isRecruiting = ref(false)

const submitting = ref(false)
const errors = ref<Record<string, string>>({})

/** Mirrors `TranslatorGroupCreateBody`. */
const MIN_NAME_LENGTH = 2

const emailVerified = computed(() => authStore.user?.emailVerified ?? false)
const canSubmit = computed(() => name.value.trim().length >= MIN_NAME_LENGTH && emailVerified.value)

async function submit(): Promise<void> {
  if (!canSubmit.value || submitting.value) return

  submitting.value = true
  errors.value = {}

  try {
    const group = await translatorsApi.create({
      name: name.value.trim(),
      ...(description.value.trim().length > 0 ? { description: description.value.trim() } : {}),
      ...(websiteUrl.value.trim().length > 0 ? { websiteUrl: websiteUrl.value.trim() } : {}),
      ...(discordUrl.value.trim().length > 0 ? { discordUrl: discordUrl.value.trim() } : {}),
      isRecruiting: isRecruiting.value
    })

    toast.success(t('translator.saved'))
    await router.push({ name: '/translator/[slug]', params: { slug: group.slug } })
  } catch (cause: unknown) {
    errors.value = fieldErrors(cause)
    toast.error(translateError(cause))
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="translator-create container mx-auto px-4 py-8 max-w-2xl">
    <h1 class="text-4xl font-bold text-text-primary mb-8">{{ t('translator.createGroup') }}</h1>

    <!-- Several actions require a verified address; saying so up front beats a
         rejected submit. -->
    <div
      v-if="!emailVerified"
      class="mb-6 p-4 rounded-lg bg-yellow-500/20 border border-yellow-500/50 text-yellow-200"
    >
      {{ t('errors.auth.emailNotVerified') }}
    </div>

    <Card variant="glass">
      <form class="space-y-6" @submit.prevent="submit">
        <div>
          <label for="name" class="block text-sm font-medium text-text-primary mb-2">
            {{ t('common.name') }}
          </label>
          <Input
            id="name"
            v-model="name"
            :minlength="MIN_NAME_LENGTH"
            maxlength="100"
            required
            variant="glass"
          />
          <p v-if="errors['name']" class="mt-1 text-sm text-red-300">{{ errors['name'] }}</p>
          <p v-else class="mt-1 text-xs text-text-muted">{{ t('translator.slugHint') }}</p>
        </div>

        <div>
          <label for="description" class="block text-sm font-medium text-text-primary mb-2">
            {{ t('anime.synopsis') }}
          </label>
          <Textarea id="description" v-model="description" :rows="4" variant="glass" />
          <p v-if="errors['description']" class="mt-1 text-sm text-red-300">
            {{ errors['description'] }}
          </p>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label for="website" class="block text-sm font-medium text-text-primary mb-2">
              {{ t('admin.dashboard.website') }}
            </label>
            <Input id="website" v-model="websiteUrl" type="url" variant="glass" />
            <p v-if="errors['websiteUrl']" class="mt-1 text-sm text-red-300">
              {{ errors['websiteUrl'] }}
            </p>
          </div>

          <div>
            <label for="discord" class="block text-sm font-medium text-text-primary mb-2">
              Discord
            </label>
            <Input id="discord" v-model="discordUrl" type="url" variant="glass" />
            <p v-if="errors['discordUrl']" class="mt-1 text-sm text-red-300">
              {{ errors['discordUrl'] }}
            </p>
          </div>
        </div>

        <label class="flex items-center gap-2 text-sm text-text-secondary">
          <input v-model="isRecruiting" type="checkbox" class="accent-primary" />
          {{ t('translator.recruiting') }}
        </label>

        <div class="flex justify-end gap-2">
          <Button variant="ghost" type="button" @click="router.back()">
            {{ t('common.cancel') }}
          </Button>
          <Button variant="primary" type="submit" :disabled="!canSubmit || submitting">
            <Plus :size="18" />
            {{ submitting ? t('common.saving') : t('translator.createGroup') }}
          </Button>
        </div>
      </form>
    </Card>
  </div>
</template>
