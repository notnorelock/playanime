<script setup lang="ts">
/**
 * Administration — translator groups.
 *
 * Two distinct powers, deliberately separated:
 *
 * - **Verification** is an administrator asserting the group is who it claims
 *   to be. A group can never grant itself the badge; that is what it certifies.
 * - **Suspension** is a moderator hiding a group pending review. Its rows and
 *   credits survive, so attribution on existing sources is not erased.
 *
 * Neither makes staff a member of the group: membership is administered by the
 * group's own leaders, through a separate path.
 */

import { computed, onUnmounted, ref, watch } from 'vue'
import { BadgeCheck, EyeOff, Search, Undo2 } from 'lucide-vue-next'
import type { TranslatorGroupSummary } from '@playanime/contracts'
import { AbortError, adminApi } from '@/api'
import { useApiError } from '@/composables/useApiError'
import { useLocale } from '@/composables/useLocale'
import { useToast } from '@/composables/useToast'
import { useAuthStore } from '@/store/auth'
import { isAdmin } from '@/utils/user'
import Card from '@/components/ui/Card.vue'
import Input from '@/components/ui/Input.vue'
import Button from '@/components/ui/Button.vue'
import Modal from '@/components/ui/Modal/Modal.vue'
import Textarea from '@/components/ui/Textarea.vue'

const { t } = useLocale()
const { translateError } = useApiError()
const toast = useToast()
const authStore = useAuthStore()

const items = ref<TranslatorGroupSummary[]>([])
const loading = ref(true)
const loadingMore = ref(false)
const hasMore = ref(false)
const searchQuery = ref('')

/** Verification is administrator-only; suspension is available to moderators. */
const canVerify = computed(() => isAdmin(authStore.user))

let cursor: string | null = null
let controller: AbortController | null = null
let debounceTimer: ReturnType<typeof setTimeout> | null = null

async function load(append = false): Promise<void> {
  controller?.abort()
  const request = new AbortController()
  controller = request

  if (append) loadingMore.value = true
  else {
    loading.value = true
    cursor = null
  }

  try {
    const page = await adminApi.translators(
      {
        limit: 25,
        ...(searchQuery.value.trim().length > 0 ? { search: searchQuery.value.trim() } : {}),
        ...(append && cursor !== null ? { cursor } : {})
      },
      request.signal
    )

    if (request.signal.aborted) return

    items.value = append ? [...items.value, ...page.items] : page.items
    cursor = page.nextCursor
    hasMore.value = page.hasMore
  } catch (cause: unknown) {
    if (AbortError.is(cause)) return
    if (!append) items.value = []
    toast.error(translateError(cause))
  } finally {
    if (controller === request) {
      loading.value = false
      loadingMore.value = false
      controller = null
    }
  }
}

watch(searchQuery, () => {
  if (debounceTimer !== null) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    void load()
  }, 300)
})

void load()

onUnmounted(() => {
  if (debounceTimer !== null) clearTimeout(debounceTimer)
  controller?.abort()
})

/* -------------------------------------------------------------------------- */
/* Actions                                                                     */
/* -------------------------------------------------------------------------- */

type Action = 'verify' | 'unverify' | 'suspend'

const target = ref<TranslatorGroupSummary | null>(null)
const action = ref<Action | null>(null)
const reason = ref('')
const submitting = ref(false)

function open(group: TranslatorGroupSummary, next: Action): void {
  target.value = group
  action.value = next
  reason.value = ''
}

function close(): void {
  target.value = null
  action.value = null
  reason.value = ''
}

async function submit(): Promise<void> {
  const group = target.value
  if (group === null || action.value === null || reason.value.trim().length === 0) return

  submitting.value = true
  const text = reason.value.trim()

  try {
    if (action.value === 'verify') await adminApi.verifyGroup(group.slug, text)
    else if (action.value === 'unverify') await adminApi.unverifyGroup(group.slug, text)
    else await adminApi.suspendGroup(group.slug, text)

    toast.success(t('admin.dashboard.manage.translators.updated'))
    close()
    await load()
  } catch (cause: unknown) {
    toast.error(translateError(cause))
  } finally {
    submitting.value = false
  }
}

const dialogTitle = computed(() => {
  switch (action.value) {
    case 'verify':
      return t('admin.dashboard.manage.translators.verify')
    case 'unverify':
      return t('admin.dashboard.manage.translators.unverify')
    default:
      return t('admin.dashboard.manage.translators.suspend')
  }
})
</script>

<template>
  <div class="admin-translators space-y-6">
    <h2 class="text-2xl font-bold text-text-primary">
      {{ t('admin.dashboard.sections.translators') }}
    </h2>

    <Card variant="glass" class="p-4">
      <div class="relative">
        <Search :size="20" class="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
        <Input
          v-model="searchQuery"
          :placeholder="t('admin.dashboard.manage.translators.search')"
          class="pl-10 w-full"
        />
      </div>
    </Card>

    <!-- Loading -->
    <div v-if="loading" class="space-y-3">
      <Card v-for="i in 4" :key="i" variant="glass" class="p-5 animate-pulse">
        <div class="h-4 bg-white/10 rounded w-1/3 mb-2"></div>
        <div class="h-3 bg-white/10 rounded w-1/4"></div>
      </Card>
    </div>

    <!-- List -->
    <div v-else-if="items.length > 0" class="space-y-3">
      <Card
        v-for="group in items"
        :key="group.id"
        variant="glass"
        class="p-5 hover:glass-strong transition-smooth"
      >
        <div class="flex flex-wrap items-center justify-between gap-4">
          <div class="flex items-center gap-4 flex-1 min-w-0">
            <img
              v-if="group.avatar"
              :src="group.avatar.url"
              :alt="group.name"
              class="w-12 h-12 rounded-lg object-cover shrink-0"
            />
            <div
              v-else
              class="w-12 h-12 rounded-lg bg-dark-700 flex items-center justify-center text-text-muted font-semibold shrink-0"
            >
              {{ group.name.charAt(0).toUpperCase() }}
            </div>

            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 mb-1 flex-wrap">
                <router-link
                  :to="`/translator/${group.slug}`"
                  class="font-semibold text-text-primary hover:text-primary transition-colors"
                >
                  {{ group.name }}
                </router-link>

                <BadgeCheck
                  v-if="group.isVerified"
                  :size="16"
                  class="text-accent-cyan"
                  :title="t('admin.dashboard.manage.translators.verified')"
                />

                <span
                  v-if="group.isRecruiting"
                  class="px-2 py-0.5 rounded-full text-xs bg-primary/20 text-primary"
                >
                  {{ t('translator.recruiting') }}
                </span>
              </div>

              <div class="flex items-center gap-4 text-sm text-text-secondary flex-wrap">
                <span>{{ t('translator.members') }}: {{ group.memberCount }}</span>
                <span>{{ t('common.anime') }}: {{ group.animeCount }}</span>
              </div>
            </div>
          </div>

          <div class="flex gap-2 shrink-0">
            <Button
              v-if="canVerify && !group.isVerified"
              variant="glass"
              size="sm"
              @click="open(group, 'verify')"
            >
              <BadgeCheck :size="16" />
              {{ t('admin.dashboard.manage.translators.verify') }}
            </Button>
            <Button
              v-else-if="canVerify"
              variant="ghost"
              size="sm"
              @click="open(group, 'unverify')"
            >
              <Undo2 :size="16" />
              {{ t('admin.dashboard.manage.translators.unverify') }}
            </Button>

            <Button variant="ghost" size="sm" @click="open(group, 'suspend')">
              <EyeOff :size="16" />
              {{ t('admin.dashboard.manage.translators.suspend') }}
            </Button>
          </div>
        </div>
      </Card>

      <div v-if="hasMore" class="text-center pt-2">
        <Button variant="glass" :disabled="loadingMore" @click="load(true)">
          {{ loadingMore ? t('common.loading') : t('common.loadMore') }}
        </Button>
      </div>
    </div>

    <Card v-else variant="glass" class="p-8 text-center text-text-secondary">
      {{ t('search.noResults') }}
    </Card>

    <!-- Dialog -->
    <Modal :model-value="action !== null" @update:model-value="close">
      <div v-if="target" class="space-y-4 p-2">
        <h3 class="text-xl font-semibold text-text-primary">
          {{ dialogTitle }} — {{ target.name }}
        </h3>

        <p v-if="action === 'suspend'" class="text-text-secondary text-sm">
          {{ t('admin.dashboard.manage.translators.suspendWarning') }}
        </p>

        <div>
          <label class="block text-sm text-text-secondary mb-1">
            {{ t('admin.dashboard.reason') }}
          </label>
          <Textarea v-model="reason" :rows="3" :placeholder="t('admin.dashboard.reasonHint')" />
        </div>

        <div class="flex justify-end gap-2 pt-2">
          <Button variant="ghost" @click="close">{{ t('common.cancel') }}</Button>
          <Button
            variant="primary"
            :disabled="submitting || reason.trim().length === 0"
            @click="submit"
          >
            {{ submitting ? t('common.saving') : t('common.save') }}
          </Button>
        </div>
      </div>
    </Modal>
  </div>
</template>
