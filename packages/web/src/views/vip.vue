<script setup lang="ts">
/**
 * VIP — public static content page, admin-editable.
 *
 * Same rendering approach as `/blog/[slug].vue`: `contentMarkdown` from the
 * database, parsed client-side via `marked`. Unlike a blog post there is no
 * "not found" 404 case — the slug is a fixed, known one (see
 * `SitePageSlug`) — only "never written yet" (`pagesApi.get` resolves to
 * `null`), shown as an empty state instead of an error.
 */

import { onMounted, ref } from 'vue'
import { marked } from 'marked'
import { Crown } from 'lucide-vue-next'
import { SitePageSlug, type SitePageDto } from '@playanime/contracts'
import { pagesApi } from '@/api'
import { useApiError } from '@/composables/useApiError'
import { useLocale } from '@/composables/useLocale'
import { usePageTitle } from '@/composables/usePageTitle'
import Card from '@/components/ui/Card.vue'
import Button from '@/components/ui/Button.vue'

const { t } = useLocale()
const { translateError } = useApiError()

marked.setOptions({ breaks: true, gfm: true })

const page = ref<SitePageDto>(null)
const html = ref('')
const loading = ref(true)
const error = ref<string | null>(null)

usePageTitle(() => page.value?.title ?? t('nav.vip'))

async function load(): Promise<void> {
  loading.value = true
  error.value = null

  try {
    const data = await pagesApi.get(SitePageSlug.VIP)
    page.value = data
    html.value = data === null ? '' : await marked.parse(data.contentMarkdown)
  } catch (cause: unknown) {
    error.value = translateError(cause)
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="vip-page container mx-auto px-4 py-8 max-w-3xl">
    <!-- Loading -->
    <div v-if="loading" class="space-y-4">
      <div class="h-8 bg-white/10 rounded w-2/3 animate-pulse"></div>
      <Card variant="glass" class="p-6 animate-pulse h-64" />
    </div>

    <!-- Error -->
    <Card v-else-if="error" variant="glass" class="p-8 text-center">
      <p class="text-text-secondary mb-4">{{ error }}</p>
      <Button variant="secondary" @click="load">{{ t('common.tryAgain') }}</Button>
    </Card>

    <!-- Empty (never written yet) -->
    <Card v-else-if="page === null" variant="glass" class="p-12 text-center">
      <Crown :size="40" class="mx-auto mb-3 text-text-muted" />
      <p class="text-text-secondary">{{ t('vip.empty') }}</p>
    </Card>

    <!-- Page -->
    <article v-else>
      <header class="mb-6 flex items-center gap-3">
        <Crown :size="28" class="text-primary shrink-0" />
        <h1 class="text-4xl font-bold text-text-primary">{{ page.title }}</h1>
      </header>

      <div class="vip-content prose prose-invert max-w-none">
        <div v-html="html" />
      </div>
    </article>
  </div>
</template>

<style scoped>
@reference "@/styles/main.css";

.vip-content :deep(h1) {
  @apply text-3xl font-bold text-text-primary mb-4 mt-8;
}
.vip-content :deep(h2) {
  @apply text-2xl font-semibold text-text-primary mb-3 mt-8;
}
.vip-content :deep(h3) {
  @apply text-xl font-semibold text-text-primary mb-2 mt-6;
}
.vip-content :deep(p) {
  @apply text-text-secondary mb-4 leading-relaxed;
}
.vip-content :deep(ul),
.vip-content :deep(ol) {
  @apply text-text-secondary mb-4 ml-6;
}
.vip-content :deep(ul li) {
  @apply list-disc;
}
.vip-content :deep(ol li) {
  @apply list-decimal;
}
.vip-content :deep(a) {
  @apply text-primary hover:text-primary-hover underline;
}
.vip-content :deep(strong) {
  @apply text-text-primary font-semibold;
}
.vip-content :deep(code) {
  @apply text-primary px-1.5 py-0.5 rounded text-sm font-mono bg-white/10;
}
.vip-content :deep(pre) {
  @apply bg-white/5 rounded-lg p-4 mb-4 overflow-x-auto;
}
.vip-content :deep(pre code) {
  @apply bg-transparent p-0;
}
.vip-content :deep(blockquote) {
  @apply border-l-4 border-primary pl-4 italic text-text-secondary my-4;
}
.vip-content :deep(img) {
  @apply max-w-full rounded-lg my-4;
}
.vip-content :deep(hr) {
  @apply my-8 border-white/10;
}
</style>
