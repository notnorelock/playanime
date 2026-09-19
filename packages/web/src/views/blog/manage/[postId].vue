<script setup lang="ts">
/**
 * Blog post editor — create and edit, one page.
 *
 * `:postId` of literal `"new"` means create mode; anything else is treated
 * as a real post id to load and edit. One file rather than a separate
 * create page, since the editor itself (title, excerpt, markdown body with
 * live preview, cover image, publish controls) is identical either way —
 * only "is there an id to load/PATCH against yet" differs.
 */

import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { marked } from 'marked'
import { ArrowLeft, Eye, EyeOff, Save } from 'lucide-vue-next'
import { UserRole, type BlogPostDetailDto, type BlogPostStatus } from '@playanime/contracts'
import { AbortError, ApiError, blogApi } from '@/api'
import { useApiError } from '@/composables/useApiError'
import { useLocale } from '@/composables/useLocale'
import { usePageTitle } from '@/composables/usePageTitle'
import { useToast } from '@/composables/useToast'
import Card from '@/components/ui/Card.vue'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import Textarea from '@/components/ui/Textarea.vue'
import Select from '@/components/ui/Select.vue'

definePage({
  meta: {
    requiresAuth: true,
    requiresRole: UserRole.ADMIN
  }
})

const route = useRoute('/blog/manage/[postId]')
const router = useRouter()
const { t, locale } = useLocale()
const { translateError } = useApiError()
const toast = useToast()

const isCreate = computed(() => route.params.postId === 'new')

usePageTitle(() => (isCreate.value ? t('admin.blog.newPost') : t('admin.blog.editPost')))

/* -------------------------------------------------------------------------- */
/* Load (edit mode only)                                                      */
/* -------------------------------------------------------------------------- */

const loading = ref(!isCreate.value)
const notFound = ref(false)
const postId = ref<string | null>(null)

const title = ref('')
const excerpt = ref('')
const contentMarkdown = ref('')
const coverImageUrl = ref('')
const status = ref<BlogPostStatus>('draft')
/** Empty string means "no schedule" — an HTML `datetime-local` input's own null-equivalent. */
const scheduledAt = ref('')
const currentSlug = ref<string | null>(null)
const publishedAtDisplay = ref<string | null>(null)

function applyPost(post: BlogPostDetailDto): void {
  postId.value = post.id
  title.value = post.title
  excerpt.value = post.excerpt ?? ''
  contentMarkdown.value = post.contentMarkdown
  coverImageUrl.value = post.coverImageUrl ?? ''
  status.value = post.status
  currentSlug.value = post.slug
  publishedAtDisplay.value = post.publishedAt
  scheduledAt.value = post.publishedAt !== null && new Date(post.publishedAt) > new Date() ? toLocalInputValue(post.publishedAt) : ''
}

function toLocalInputValue(iso: string): string {
  const date = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

let controller: AbortController | null = null

async function load(): Promise<void> {
  if (isCreate.value) {
    loading.value = false
    return
  }

  controller?.abort()
  const request = new AbortController()
  controller = request
  loading.value = true

  try {
    const post = await blogApi.adminGet(route.params.postId, request.signal)
    applyPost(post)
  } catch (cause: unknown) {
    if (AbortError.is(cause)) return
    if (ApiError.is(cause) && cause.status === 404) {
      notFound.value = true
    } else {
      toast.error(translateError(cause))
    }
  } finally {
    if (controller === request) {
      loading.value = false
      controller = null
    }
  }
}

onMounted(load)
onUnmounted(() => controller?.abort())

/* -------------------------------------------------------------------------- */
/* Preview                                                                     */
/* -------------------------------------------------------------------------- */

marked.setOptions({ breaks: true, gfm: true })

const showPreview = ref(true)
const previewHtml = ref('')

watch(
  contentMarkdown,
  async (value) => {
    previewHtml.value = await marked.parse(value)
  },
  { immediate: true }
)

/* -------------------------------------------------------------------------- */
/* Save                                                                        */
/* -------------------------------------------------------------------------- */

const saving = ref(false)

async function saveDraft(): Promise<void> {
  await save('draft')
}

async function publishNow(): Promise<void> {
  await save('published', true)
}

/**
 * `asPublish` forces status to 'published' with no explicit publishedAt —
 * the API stamps "now" in that case (see blog.service.ts). Saving a
 * SCHEDULED post (a future scheduledAt set while status is 'draft') also
 * goes through here: status becomes 'published' but publishedAt carries
 * the future date, which the public route already treats as "exists but
 * not yet visible."
 */
async function save(nextStatus: BlogPostStatus, forceNow = false): Promise<void> {
  if (title.value.trim().length === 0) {
    toast.error(t('admin.blog.titleRequired'))
    return
  }

  saving.value = true
  try {
    const publishedAt = forceNow
      ? undefined // let the API stamp "now"
      : scheduledAt.value.length > 0
        ? new Date(scheduledAt.value).toISOString()
        : nextStatus === 'draft'
          ? null
          : undefined

    if (isCreate.value) {
      const created = await blogApi.create({
        title: title.value.trim(),
        excerpt: excerpt.value.trim().length > 0 ? excerpt.value.trim() : null,
        contentMarkdown: contentMarkdown.value,
        coverImageUrl: coverImageUrl.value.trim().length > 0 ? coverImageUrl.value.trim() : null
      })
      // A brand-new post's create call always makes a draft (see contracts
      // doc comment) — if the user actually asked for it published/
      // scheduled in the same action, immediately follow with the update
      // that sets that, rather than a second manual "now publish it" step.
      if (nextStatus === 'published' || scheduledAt.value.length > 0) {
        await blogApi.update(created.id, { status: 'published', ...(publishedAt === undefined ? {} : { publishedAt }) })
      }
      toast.success(t('admin.blog.created'))
      await router.replace(`/blog/manage/${created.id}`)
      await load()
    } else if (postId.value !== null) {
      const updated = await blogApi.update(postId.value, {
        title: title.value.trim(),
        excerpt: excerpt.value.trim().length > 0 ? excerpt.value.trim() : null,
        contentMarkdown: contentMarkdown.value,
        coverImageUrl: coverImageUrl.value.trim().length > 0 ? coverImageUrl.value.trim() : null,
        status: nextStatus,
        ...(publishedAt === undefined ? {} : { publishedAt })
      })
      applyPost(updated)
      toast.success(t('common.saveChanges'))
    }
  } catch (cause: unknown) {
    toast.error(translateError(cause))
  } finally {
    saving.value = false
  }
}

function back(): void {
  router.push('/admin/dashboard')
}

const statusOptions = computed(() => [
  { label: t('admin.blog.statusDraft'), value: 'draft' },
  { label: t('admin.blog.statusPublished'), value: 'published' }
])

function formatDate(value: string | null): string {
  if (value === null) return '—'
  return new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}
</script>

<template>
  <div class="blog-editor container mx-auto px-4 py-8 max-w-6xl">
    <div class="flex items-center gap-3 mb-6">
      <Button variant="ghost" size="sm" icon @click="back">
        <ArrowLeft :size="18" />
      </Button>
      <h1 class="text-2xl font-bold text-text-primary">
        {{ isCreate ? t('admin.blog.newPost') : t('admin.blog.editPost') }}
      </h1>
    </div>

    <div v-if="loading" class="space-y-4">
      <Card variant="glass" class="p-6 animate-pulse h-96" />
    </div>

    <Card v-else-if="notFound" variant="glass" class="p-12 text-center text-text-secondary">
      {{ t('admin.blog.notFound') }}
    </Card>

    <template v-else>
      <div class="grid grid-cols-12 gap-6">
        <!-- Main editor -->
        <div class="col-span-12 lg:col-span-8 space-y-4">
          <Card variant="glass" class="p-5 space-y-4">
            <div>
              <label class="block text-sm text-text-secondary mb-1">{{ t('admin.blog.postTitle') }}</label>
              <Input v-model="title" :placeholder="t('admin.blog.postTitlePlaceholder')" />
            </div>

            <div>
              <label class="block text-sm text-text-secondary mb-1">{{ t('admin.blog.excerpt') }}</label>
              <Textarea v-model="excerpt" :rows="2" :placeholder="t('admin.blog.excerptPlaceholder')" />
            </div>

            <div>
              <label class="block text-sm text-text-secondary mb-1">{{ t('admin.blog.coverImageUrl') }}</label>
              <Input v-model="coverImageUrl" placeholder="https://..." />
            </div>
          </Card>

          <Card variant="glass" class="p-5 space-y-3">
            <div class="flex items-center justify-between">
              <label class="text-sm text-text-secondary">{{ t('admin.blog.content') }} (Markdown)</label>
              <Button variant="ghost" size="sm" @click="showPreview = !showPreview">
                <component :is="showPreview ? EyeOff : Eye" :size="16" />
                {{ showPreview ? t('admin.blog.hidePreview') : t('admin.blog.showPreview') }}
              </Button>
            </div>

            <div class="grid gap-3" :class="showPreview ? 'grid-cols-1 xl:grid-cols-2' : 'grid-cols-1'">
              <textarea
                v-model="contentMarkdown"
                class="w-full min-h-[28rem] rounded-lg bg-white/5 border border-white/10 p-4 text-sm font-mono text-text-primary outline-none focus:border-primary/50 transition-smooth resize-y"
                :placeholder="t('admin.blog.contentPlaceholder')"
              />

              <div
                v-if="showPreview"
                class="min-h-[28rem] rounded-lg bg-white/5 border border-white/10 p-4 overflow-y-auto prose prose-invert max-w-none blog-preview"
                v-html="previewHtml"
              />
            </div>
          </Card>
        </div>

        <!-- Publish sidebar -->
        <div class="col-span-12 lg:col-span-4 space-y-4">
          <Card variant="glass" class="p-5 space-y-4 sticky top-4">
            <div>
              <label class="block text-sm text-text-secondary mb-1">{{ t('admin.blog.status') }}</label>
              <Select v-model="status" :options="statusOptions" />
            </div>

            <div>
              <label class="block text-sm text-text-secondary mb-1">{{ t('admin.blog.scheduleFor') }}</label>
              <input
                v-model="scheduledAt"
                type="datetime-local"
                class="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-text-primary outline-none focus:border-primary/50 transition-smooth"
              />
              <p class="text-xs text-text-muted mt-1">{{ t('admin.blog.scheduleHint') }}</p>
            </div>

            <div v-if="currentSlug !== null" class="text-xs text-text-muted break-all">
              {{ t('admin.blog.slugLabel') }}: <span class="text-text-secondary">{{ currentSlug }}</span>
            </div>
            <div v-if="publishedAtDisplay !== null" class="text-xs text-text-muted">
              {{ formatDate(publishedAtDisplay) }}
            </div>

            <div class="flex flex-col gap-2 pt-2">
              <Button variant="secondary" :disabled="saving" @click="saveDraft">
                <Save :size="16" />
                {{ saving ? t('common.saving') : t('admin.blog.saveDraft') }}
              </Button>
              <Button variant="primary" :disabled="saving" @click="publishNow">
                {{ saving ? t('common.saving') : t('admin.blog.publishNow') }}
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
@reference "@/styles/main.css";

.blog-preview :deep(h1) {
  @apply text-3xl font-bold text-text-primary mb-4 mt-6;
}
.blog-preview :deep(h2) {
  @apply text-2xl font-semibold text-text-primary mb-3 mt-6;
}
.blog-preview :deep(h3) {
  @apply text-xl font-semibold text-text-primary mb-2 mt-4;
}
.blog-preview :deep(p) {
  @apply text-text-secondary mb-3 leading-relaxed;
}
.blog-preview :deep(ul),
.blog-preview :deep(ol) {
  @apply text-text-secondary mb-3 ml-6;
}
.blog-preview :deep(ul li) {
  @apply list-disc;
}
.blog-preview :deep(ol li) {
  @apply list-decimal;
}
.blog-preview :deep(a) {
  @apply text-primary hover:text-primary-hover underline;
}
.blog-preview :deep(strong) {
  @apply text-text-primary font-semibold;
}
.blog-preview :deep(code) {
  @apply text-primary px-1.5 py-0.5 rounded text-sm font-mono bg-white/10;
}
.blog-preview :deep(pre) {
  @apply bg-white/5 rounded-lg p-4 mb-3 overflow-x-auto;
}
.blog-preview :deep(pre code) {
  @apply bg-transparent p-0;
}
.blog-preview :deep(blockquote) {
  @apply border-l-4 border-primary pl-4 italic text-text-secondary my-3;
}
.blog-preview :deep(img) {
  @apply max-w-full rounded-lg my-3;
}
</style>
