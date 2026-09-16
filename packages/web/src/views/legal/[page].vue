<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useLocale } from '@/composables/useLocale'
import { usePageTitle } from '@/composables/usePageTitle'
import { marked } from 'marked'
import { FileText } from 'lucide-vue-next'

const route = useRoute('/legal/[page]')
const { t, locale } = useLocale()

const markdownContent = ref<string>('')
const htmlContent = ref<string>('')
const loading = ref(true)
const error = ref<string | null>(null)

// Get page from route params
const page = computed(() => route.params.page)

// Page titles mapping
const pageTitles: Record<string, string> = {
  'tos': 'Terms of Service',
  'privacy': 'Privacy Policy'
}

const pageTitle = computed(() => {
  const key = page.value
  return pageTitles[key] || 'Legal'
})

// Set page title
usePageTitle(() => pageTitle.value)

// Configure marked options
marked.setOptions({
  breaks: true,
  gfm: true
})

// Load markdown file based on page and locale
const loadMarkdown = async () => {
  try {
    loading.value = true
    error.value = null

    const pageName = page.value
    const lang = locale.value

    // Construct file path: /legal/{page}_{lang}.md
    const filePath = `/legal/${pageName}_${lang}.md`

    console.log(`Loading legal page: ${filePath}`)

    // Fetch markdown file from public directory
    const response = await fetch(filePath)

    if (!response.ok) {
      throw new Error(`Failed to load legal document: ${response.status}`)
    }

    markdownContent.value = await response.text()

    // Convert markdown to HTML
    htmlContent.value = await marked.parse(markdownContent.value)
  } catch (err) {
    console.error('Error loading markdown:', err)
    error.value = err instanceof Error ? err.message : 'Failed to load legal document'
  } finally {
    loading.value = false
  }
}

// Watch for page or locale changes
watch([page, locale], () => {
  loadMarkdown()
}, { immediate: true })

onMounted(() => {
  loadMarkdown()
})
</script>

<template>
  <div class="legal-page container mx-auto px-4 py-8 max-w-4xl">
    <!-- Loading state -->
    <div v-if="loading" class="flex items-center justify-center py-20">
      <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
    </div>

    <!-- Error state -->
    <div v-else-if="error" class="bg-red-500/10 border border-red-500/20 rounded-lg p-6 text-center">
      <FileText class="w-12 h-12 mx-auto mb-4 text-red-500" />
      <h2 class="text-xl font-semibold text-red-500 mb-2">{{ t('common.error') }}</h2>
      <p class="text-text-secondary">{{ error }}</p>
    </div>

    <!-- Content -->
    <div v-else class="legal-content prose prose-invert max-w-none">
      <div v-html="htmlContent" />
    </div>
  </div>
</template>

<style scoped>
@reference "@/styles/main.css";

/* Legal document styling */
.legal-content {
  @apply text-text-primary;
}

/* Prose styling for markdown content */
.legal-content :deep(h1) {
  @apply text-4xl font-bold text-text-primary mb-6 mt-8;
}

.legal-content :deep(h2) {
  @apply text-3xl font-semibold text-text-primary mb-4 mt-8 border-b pb-2;
}

.legal-content :deep(h3) {
  @apply text-2xl font-semibold text-text-primary mb-3 mt-6;
}

.legal-content :deep(h4) {
  @apply text-xl font-semibold text-text-primary mb-2 mt-4;
}

.legal-content :deep(p) {
  @apply text-text-secondary mb-4 leading-relaxed;
}

.legal-content :deep(ul), .legal-content :deep(ol) {
  @apply text-text-secondary mb-4 ml-6;
}

.legal-content :deep(li) {
  @apply mb-2;
}

.legal-content :deep(ul li) {
  @apply list-disc;
}

.legal-content :deep(ol li) {
  @apply list-decimal;
}

.legal-content :deep(a) {
  @apply text-primary hover:text-primary-hover underline;
}

.legal-content :deep(strong), .legal-content :deep(b) {
  @apply text-text-primary font-semibold;
}

.legal-content :deep(em), .legal-content :deep(i) {
  @apply italic;
}

.legal-content :deep(code) {
  @apply  text-primary px-1.5 py-0.5 rounded text-sm font-mono;
}

.legal-content :deep(pre) {
  @apply  rounded-lg p-4 mb-4 overflow-x-auto;
}

.legal-content :deep(pre code) {
  @apply bg-transparent p-0;
}

.legal-content :deep(blockquote) {
  @apply border-l-4 border-primary pl-4 italic text-text-secondary my-4;
}

.legal-content :deep(hr) {
  @apply my-8;
}

.legal-content :deep(table) {
  @apply w-full mb-4 border-collapse;
}

.legal-content :deep(th) {
  @apply  text-text-primary font-semibold p-3 text-left border;
}

.legal-content :deep(td) {
  @apply text-text-secondary p-3 border;
}

/* First paragraph after heading */
.legal-content :deep(h1 + p),
.legal-content :deep(h2 + p) {
  @apply mt-0;
}
</style>
