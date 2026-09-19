<script setup lang="ts">
/**
 * One blog post — public detail page.
 *
 * Renders `contentMarkdown` client-side via `marked`, same library and same
 * general shape as `/legal/[page].vue`'s static-file rendering, but the
 * content itself comes from the database via `GET /blog/posts/:slug`
 * rather than a fetched .md file.
 */

import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { marked } from 'marked'
import { ArrowLeft, FileText } from 'lucide-vue-next'
import type { BlogPostDetailDto } from '@playanime/contracts'
import { ApiError, blogApi } from '@/api'
import { useApiError } from '@/composables/useApiError'
import { useLocale } from '@/composables/useLocale'
import { usePageTitle } from '@/composables/usePageTitle'
import Card from '@/components/ui/Card.vue'
import Button from '@/components/ui/Button.vue'

const route = useRoute('/blog/[slug]')
const router = useRouter()
const { t, locale } = useLocale()
const { translateError } = useApiError()

marked.setOptions({ breaks: true, gfm: true })

const post = ref<BlogPostDetailDto | null>(null)
const html = ref('')
const loading = ref(true)
const notFound = ref(false)
const error = ref<string | null>(null)

usePageTitle(() => post.value?.title ?? t('blog.title'))

async function load(): Promise<void> {
  loading.value = true
  notFound.value = false
  error.value = null

  try {
    const data = await blogApi.bySlug(route.params.slug)
    post.value = data
    html.value = await marked.parse(data.contentMarkdown)
  } catch (cause: unknown) {
    if (ApiError.is(cause) && cause.status === 404) {
      notFound.value = true
    } else {
      error.value = translateError(cause)
    }
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch(() => route.params.slug, load)

function back(): void {
  router.push('/blog')
}

const formattedDate = computed(() => {
  if (post.value?.publishedAt == null) return ''
  return new Intl.DateTimeFormat(locale.value, { dateStyle: 'long' }).format(new Date(post.value.publishedAt))
})
</script>

<template>
  <div class="blog-post container mx-auto px-4 py-8 max-w-3xl">
    <Button variant="ghost" size="sm" class="mb-4" @click="back">
      <ArrowLeft :size="16" />
      {{ t('blog.backToList') }}
    </Button>

    <!-- Loading -->
    <div v-if="loading" class="space-y-4">
      <div class="h-8 bg-white/10 rounded w-2/3 animate-pulse"></div>
      <div class="h-4 bg-white/10 rounded w-1/3 animate-pulse"></div>
      <Card variant="glass" class="p-6 animate-pulse h-64" />
    </div>

    <!-- Not found -->
    <Card v-else-if="notFound" variant="glass" class="p-12 text-center">
      <FileText :size="40" class="mx-auto mb-3 text-text-muted" />
      <p class="text-text-secondary">{{ t('blog.notFound') }}</p>
    </Card>

    <!-- Error -->
    <Card v-else-if="error" variant="glass" class="p-8 text-center">
      <p class="text-text-secondary mb-4">{{ error }}</p>
      <Button variant="secondary" @click="load">{{ t('common.tryAgain') }}</Button>
    </Card>

    <!-- Post -->
    <article v-else-if="post">
      <header class="mb-6">
        <h1 class="text-4xl font-bold text-text-primary mb-3">{{ post.title }}</h1>
        <p class="text-sm text-text-muted">
          {{ post.authorUsername }} <template v-if="formattedDate"> · {{ formattedDate }}</template>
        </p>
      </header>

      <img
        v-if="post.coverImageUrl"
        :src="post.coverImageUrl"
        :alt="post.title"
        class="w-full rounded-xl mb-6 object-cover max-h-96"
      />

      <div class="blog-content prose prose-invert max-w-none">
        <div v-html="html" />
      </div>
    </article>
  </div>
</template>

<style scoped>
@reference "@/styles/main.css";

.blog-content :deep(h1) {
  @apply text-3xl font-bold text-text-primary mb-4 mt-8;
}
.blog-content :deep(h2) {
  @apply text-2xl font-semibold text-text-primary mb-3 mt-8;
}
.blog-content :deep(h3) {
  @apply text-xl font-semibold text-text-primary mb-2 mt-6;
}
.blog-content :deep(p) {
  @apply text-text-secondary mb-4 leading-relaxed;
}
.blog-content :deep(ul),
.blog-content :deep(ol) {
  @apply text-text-secondary mb-4 ml-6;
}
.blog-content :deep(ul li) {
  @apply list-disc;
}
.blog-content :deep(ol li) {
  @apply list-decimal;
}
.blog-content :deep(a) {
  @apply text-primary hover:text-primary-hover underline;
}
.blog-content :deep(strong) {
  @apply text-text-primary font-semibold;
}
.blog-content :deep(code) {
  @apply text-primary px-1.5 py-0.5 rounded text-sm font-mono bg-white/10;
}
.blog-content :deep(pre) {
  @apply bg-white/5 rounded-lg p-4 mb-4 overflow-x-auto;
}
.blog-content :deep(pre code) {
  @apply bg-transparent p-0;
}
.blog-content :deep(blockquote) {
  @apply border-l-4 border-primary pl-4 italic text-text-secondary my-4;
}
.blog-content :deep(img) {
  @apply max-w-full rounded-lg my-4;
}
.blog-content :deep(hr) {
  @apply my-8 border-white/10;
}
</style>
