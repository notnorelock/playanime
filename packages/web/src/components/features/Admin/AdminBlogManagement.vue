<script setup lang="ts">
/**
 * Blog post list — admin dashboard tab.
 *
 * List only; writing/editing a post happens on its own full page
 * (`/blog/manage/new` or `/blog/manage/:postId`), same as the catalogue's
 * own create/manage pages — a markdown editor with a live preview needs
 * real room, more than a dashboard-tab panel or a modal can give it.
 */

import { onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { FileEdit, FileText, Plus, Trash2 } from 'lucide-vue-next'
import type { BlogPostSummaryDto, BlogPostStatus } from '@playanime/contracts'
import { AbortError, blogApi } from '@/api'
import { useApiError } from '@/composables/useApiError'
import { useLocale } from '@/composables/useLocale'
import { useToast } from '@/composables/useToast'
import Card from '@/components/ui/Card.vue'
import Button from '@/components/ui/Button.vue'
import Modal from '@/components/ui/Modal/Modal.vue'

type Filter = BlogPostStatus | 'all'

const router = useRouter()
const { t, locale } = useLocale()
const { translateError } = useApiError()
const toast = useToast()

const posts = ref<BlogPostSummaryDto[]>([])
const loading = ref(true)
const filter = ref<Filter>('all')

let controller: AbortController | null = null

async function load(): Promise<void> {
  controller?.abort()
  const request = new AbortController()
  controller = request
  loading.value = true

  try {
    posts.value = (
      await blogApi.adminList(filter.value === 'all' ? undefined : filter.value, undefined, 50, request.signal)
    ).items
  } catch (cause: unknown) {
    if (AbortError.is(cause)) return
    posts.value = []
    toast.error(translateError(cause))
  } finally {
    if (controller === request) {
      loading.value = false
      controller = null
    }
  }
}

onMounted(load)
watch(filter, load)

onUnmounted(() => {
  controller?.abort()
})

function create(): void {
  router.push('/blog/manage/new')
}

function edit(post: BlogPostSummaryDto): void {
  router.push(`/blog/manage/${post.id}`)
}

/* -------------------------------------------------------------------------- */
/* Delete                                                                      */
/* -------------------------------------------------------------------------- */

const target = ref<BlogPostSummaryDto | null>(null)
const deleting = ref(false)

function askDelete(post: BlogPostSummaryDto): void {
  target.value = post
}

function closeDelete(): void {
  target.value = null
}

async function confirmDelete(): Promise<void> {
  const post = target.value
  if (post === null) return

  deleting.value = true
  try {
    await blogApi.remove(post.id)
    toast.success(t('admin.blog.deleted'))
    closeDelete()
    await load()
  } catch (cause: unknown) {
    toast.error(translateError(cause))
  } finally {
    deleting.value = false
  }
}

function formatDate(value: string | null): string {
  if (value === null) return '—'
  return new Intl.DateTimeFormat(locale.value, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}
</script>

<template>
  <div class="admin-blog-management space-y-6">
    <div class="flex items-center justify-between flex-wrap gap-3">
      <h2 class="text-2xl font-bold text-text-primary">{{ t('admin.blog.title') }}</h2>

      <div class="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          class="px-3 py-1.5 rounded-lg text-sm transition-smooth"
          :class="filter === 'all' ? 'bg-primary text-white' : 'text-text-secondary hover:bg-white/10'"
          @click="filter = 'all'"
        >
          {{ t('common.all') }}
        </button>
        <button
          type="button"
          class="px-3 py-1.5 rounded-lg text-sm transition-smooth"
          :class="filter === 'published' ? 'bg-primary text-white' : 'text-text-secondary hover:bg-white/10'"
          @click="filter = 'published'"
        >
          {{ t('admin.blog.statusPublished') }}
        </button>
        <button
          type="button"
          class="px-3 py-1.5 rounded-lg text-sm transition-smooth"
          :class="filter === 'draft' ? 'bg-primary text-white' : 'text-text-secondary hover:bg-white/10'"
          @click="filter = 'draft'"
        >
          {{ t('admin.blog.statusDraft') }}
        </button>

        <Button variant="primary" size="sm" @click="create">
          <Plus :size="16" />
          {{ t('admin.blog.newPost') }}
        </Button>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="space-y-3">
      <Card v-for="i in 3" :key="i" variant="glass" class="p-5 animate-pulse">
        <div class="h-4 bg-white/10 rounded w-1/3 mb-2"></div>
        <div class="h-3 bg-white/10 rounded w-1/2"></div>
      </Card>
    </div>

    <!-- List -->
    <template v-else-if="posts.length > 0">
      <Card v-for="post in posts" :key="post.id" variant="glass" class="p-5 hover:glass-strong transition-smooth">
        <div class="flex items-start justify-between gap-4 flex-wrap">
          <div class="min-w-0 flex-1 cursor-pointer" @click="edit(post)">
            <div class="flex items-center gap-2 flex-wrap mb-1">
              <span class="font-semibold text-text-primary">{{ post.title }}</span>
              <span
                v-if="post.publishedAt !== null && new Date(post.publishedAt) <= new Date()"
                class="px-2 py-0.5 rounded-full text-xs bg-green-500/20 text-green-400"
              >
                {{ t('admin.blog.statusPublished') }}
              </span>
              <span
                v-else-if="post.publishedAt !== null"
                class="px-2 py-0.5 rounded-full text-xs bg-accent-cyan/20 text-accent-cyan"
              >
                {{ t('admin.blog.statusScheduled') }}
              </span>
              <span v-else class="px-2 py-0.5 rounded-full text-xs bg-dark-600 text-text-muted">
                {{ t('admin.blog.statusDraft') }}
              </span>
            </div>

            <p v-if="post.excerpt" class="text-sm text-text-muted mb-2 line-clamp-1">{{ post.excerpt }}</p>

            <p class="text-xs text-text-muted">
              {{ t('admin.blog.byAuthor', { author: post.authorUsername }) }}
              <template v-if="post.publishedAt !== null"> · {{ formatDate(post.publishedAt) }}</template>
            </p>
          </div>

          <div class="flex items-center gap-2 shrink-0">
            <Button variant="ghost" size="sm" icon @click="edit(post)">
              <FileEdit :size="16" />
            </Button>
            <Button variant="ghost" size="sm" icon @click="askDelete(post)">
              <Trash2 :size="16" class="text-red-400" />
            </Button>
          </div>
        </div>
      </Card>
    </template>

    <Card v-else variant="glass" class="p-12 text-center">
      <FileText :size="40" class="mx-auto mb-3 text-text-muted" />
      <p class="text-text-secondary mb-4">{{ t('admin.blog.empty') }}</p>
      <Button variant="primary" @click="create">
        <Plus :size="16" />
        {{ t('admin.blog.newPost') }}
      </Button>
    </Card>

    <!-- Delete confirmation -->
    <Modal :model-value="target !== null" @update:model-value="closeDelete">
      <div v-if="target" class="space-y-4 p-2">
        <h3 class="text-xl font-semibold text-text-primary">{{ t('admin.blog.confirmDeleteTitle') }}</h3>
        <p class="text-sm text-text-secondary">{{ t('admin.blog.confirmDeleteMessage', { title: target.title }) }}</p>

        <div class="flex justify-end gap-2 pt-2">
          <Button variant="ghost" @click="closeDelete">{{ t('common.cancel') }}</Button>
          <Button variant="primary" class="bg-red-600 hover:bg-red-700" :disabled="deleting" @click="confirmDelete">
            {{ deleting ? t('common.saving') : t('common.delete') }}
          </Button>
        </div>
      </div>
    </Modal>
  </div>
</template>
