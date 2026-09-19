<script setup lang="ts">
/**
 * Blog — public post list.
 *
 * Announcements/news, same idea as the legal pages but database-backed and
 * admin-authored through its own editor rather than hand-edited markdown
 * files (see /blog/manage for that side).
 */

import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Newspaper } from 'lucide-vue-next'
import type { BlogPostSummaryDto } from '@playanime/contracts'
import { blogApi } from '@/api'
import { useApiError } from '@/composables/useApiError'
import { useLocale } from '@/composables/useLocale'
import { usePageTitle } from '@/composables/usePageTitle'
import Card from '@/components/ui/Card.vue'
import Button from '@/components/ui/Button.vue'

const router = useRouter()
const { t, locale } = useLocale()
const { translateError } = useApiError()

usePageTitle(() => t('blog.title'))

const posts = ref<BlogPostSummaryDto[]>([])
const loading = ref(true)
const error = ref<string | null>(null)
const nextCursor = ref<string | null>(null)
const loadingMore = ref(false)

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const page = await blogApi.list()
    posts.value = page.items
    nextCursor.value = page.nextCursor
  } catch (cause: unknown) {
    error.value = translateError(cause)
  } finally {
    loading.value = false
  }
}

async function loadMore(): Promise<void> {
  if (nextCursor.value === null || loadingMore.value) return
  loadingMore.value = true
  try {
    const page = await blogApi.list(nextCursor.value)
    posts.value = [...posts.value, ...page.items]
    nextCursor.value = page.nextCursor
  } catch (cause: unknown) {
    error.value = translateError(cause)
  } finally {
    loadingMore.value = false
  }
}

onMounted(load)

function open(post: BlogPostSummaryDto): void {
  router.push(`/blog/${post.slug}`)
}

function formatDate(value: string | null): string {
  if (value === null) return ''
  return new Intl.DateTimeFormat(locale.value, { dateStyle: 'long' }).format(new Date(value))
}
</script>

<template>
  <div class="blog-list container mx-auto px-4 py-8 max-w-4xl">
    <div class="mb-8">
      <h1 class="text-4xl font-bold text-text-primary mb-2">{{ t('blog.title') }}</h1>
      <p class="text-text-secondary">{{ t('blog.subtitle') }}</p>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="space-y-4">
      <Card v-for="i in 4" :key="i" variant="glass" class="p-6 animate-pulse">
        <div class="h-5 bg-white/10 rounded w-2/3 mb-3"></div>
        <div class="h-3 bg-white/10 rounded w-full mb-2"></div>
        <div class="h-3 bg-white/10 rounded w-1/3"></div>
      </Card>
    </div>

    <!-- Error -->
    <Card v-else-if="error" variant="glass" class="p-8 text-center">
      <p class="text-text-secondary mb-4">{{ error }}</p>
      <Button variant="secondary" @click="load">{{ t('common.tryAgain') }}</Button>
    </Card>

    <!-- Empty -->
    <Card v-else-if="posts.length === 0" variant="glass" class="p-12 text-center">
      <Newspaper :size="40" class="mx-auto mb-3 text-text-muted" />
      <p class="text-text-secondary">{{ t('blog.empty') }}</p>
    </Card>

    <!-- List -->
    <template v-else>
      <div class="space-y-4">
        <Card
          v-for="post in posts"
          :key="post.id"
          variant="glass"
          class="overflow-hidden cursor-pointer hover:glass-strong transition-smooth"
          padding="none"
          @click="open(post)"
        >
          <div class="flex flex-col sm:flex-row">
            <img
              v-if="post.coverImageUrl"
              :src="post.coverImageUrl"
              :alt="post.title"
              class="w-full sm:w-56 h-40 sm:h-auto object-cover"
            />
            <div class="p-5 flex-1 min-w-0">
              <h2 class="text-xl font-bold text-text-primary mb-1">{{ post.title }}</h2>
              <p v-if="post.excerpt" class="text-text-secondary text-sm mb-3 line-clamp-2">{{ post.excerpt }}</p>
              <p class="text-xs text-text-muted">
                {{ post.authorUsername }} · {{ formatDate(post.publishedAt) }}
              </p>
            </div>
          </div>
        </Card>
      </div>

      <div v-if="nextCursor !== null" class="mt-6 text-center">
        <Button variant="secondary" :disabled="loadingMore" @click="loadMore">
          {{ loadingMore ? t('common.loading') : t('common.loadMore') }}
        </Button>
      </div>
    </template>
  </div>
</template>
