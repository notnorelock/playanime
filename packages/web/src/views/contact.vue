<script setup lang="ts">
/**
 * Contact page.
 *
 * Linked from the footer. Open to anonymous visitors — logged-in fields are
 * prefilled from the session as a convenience, never required. Submitting
 * emails CONTACT_EMAIL directly; there is no moderation queue or stored
 * record on this side, unlike `reports`, which this is deliberately not
 * part of (a general inquiry has no target row to attach to).
 */

import { onMounted, ref } from 'vue'
import { Mail } from 'lucide-vue-next'
import { contactApi } from '@/api'
import { useApiError } from '@/composables/useApiError'
import { useLocale } from '@/composables/useLocale'
import { usePageTitle } from '@/composables/usePageTitle'
import { useAuthStore } from '@/store/auth'
import Input from '@/components/ui/Input.vue'
import Textarea from '@/components/ui/Textarea.vue'
import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import TurnstileWidget from '@/components/ui/TurnstileWidget.vue'

const { t } = useLocale()
const { translateError } = useApiError()
const authStore = useAuthStore()

usePageTitle(() => t('pageTitle.contact'))

const name = ref('')
const email = ref('')
const subject = ref('')
const message = ref('')
const submitting = ref(false)
const submitted = ref(false)
const submissionError = ref<string | null>(null)

const turnstileToken = ref('')
const turnstileWidget = ref<InstanceType<typeof TurnstileWidget> | null>(null)

onMounted(() => {
  const user = authStore.user
  if (user === null) return
  name.value = user.displayName ?? user.username
  email.value = user.email
})

async function submit(): Promise<void> {
  if (
    name.value.trim().length === 0 ||
    email.value.trim().length === 0 ||
    subject.value.trim().length === 0 ||
    message.value.trim().length === 0
  ) {
    return
  }

  if (turnstileToken.value.length === 0) {
    submissionError.value = t('errors.turnstileFailed')
    return
  }

  submitting.value = true
  submissionError.value = null

  try {
    await contactApi.send({
      name: name.value.trim(),
      email: email.value.trim(),
      subject: subject.value.trim(),
      message: message.value.trim(),
      turnstileToken: turnstileToken.value
    })
    submitted.value = true
  } catch (cause: unknown) {
    submissionError.value = translateError(cause)
    // Single-use token — a failed submit already burned it.
    turnstileToken.value = ''
    turnstileWidget.value?.reset()
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="contact-page container mx-auto px-4 py-12 max-w-2xl">
    <div class="flex items-center gap-3 mb-2">
      <Mail :size="28" class="text-primary" />
      <h1 class="text-4xl font-bold text-text-primary">{{ t('contact.title') }}</h1>
    </div>
    <p class="text-text-secondary mb-8">{{ t('contact.subtitle') }}</p>

    <Card v-if="submitted" variant="glass" class="p-8 text-center">
      <p class="text-text-primary text-lg mb-2">{{ t('contact.submittedTitle') }}</p>
      <p class="text-text-secondary">{{ t('contact.submittedMessage') }}</p>
    </Card>

    <form v-else class="space-y-4" @submit.prevent="submit">
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label class="block text-sm text-text-secondary mb-1">{{ t('contact.nameLabel') }}</label>
          <Input v-model="name" :placeholder="t('contact.namePlaceholder')" />
        </div>
        <div>
          <label class="block text-sm text-text-secondary mb-1">{{ t('contact.emailLabel') }}</label>
          <Input v-model="email" type="email" :placeholder="t('contact.emailPlaceholder')" />
        </div>
      </div>

      <div>
        <label class="block text-sm text-text-secondary mb-1">{{ t('contact.subjectLabel') }}</label>
        <Input v-model="subject" :placeholder="t('contact.subjectPlaceholder')" />
      </div>

      <div>
        <label class="block text-sm text-text-secondary mb-1">{{ t('contact.messageLabel') }}</label>
        <Textarea v-model="message" :rows="6" :placeholder="t('contact.messagePlaceholder')" />
      </div>

      <div>
        <label class="block text-sm text-text-secondary mb-1">{{ t('common.securityCheck') }}</label>
        <TurnstileWidget
          ref="turnstileWidget"
          action="contact"
          @verified="(token) => (turnstileToken = token)"
          @expired="turnstileToken = ''"
          @error="turnstileToken = ''"
        />
      </div>

      <p v-if="submissionError" class="text-sm text-red-400">{{ submissionError }}</p>

      <Button
        type="submit"
        variant="primary"
        :disabled="submitting || turnstileToken.length === 0"
        class="w-full sm:w-auto"
      >
        {{ submitting ? t('common.saving') : t('contact.submit') }}
      </Button>
    </form>
  </div>
</template>
