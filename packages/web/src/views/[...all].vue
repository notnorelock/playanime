<script setup lang="ts">
import { useRouter } from 'vue-router'
import { useLocale } from '@/composables/useLocale'
import { Home } from 'lucide-vue-next'
import Button from '@/components/ui/Button.vue'

const router = useRouter()
const { t } = useLocale()

const goHome = () => {
  router.push({ name: '/' })
}
</script>

<template>
  <div class="not-found min-h-[80vh] flex items-center justify-center">
    <div class="text-center px-4">
      <div class="text-9xl font-bold text-gradient-primary mb-4">404</div>
      <h1 class="text-4xl font-bold text-text-primary mb-4">{{ t('error.404') }}</h1>
      <p class="text-text-secondary mb-8 max-w-md mx-auto">
        The page you're looking for doesn't exist or has been moved.
      </p>
      <Button variant="primary" size="lg" @click="goHome">
        <Home :size="20" />
        {{ t('common.backToHome') }}
      </Button>
    </div>
  </div>
</template>
