<script setup lang="ts">
/**
 * Translator group page.
 *
 * Public: attribution is the point of the feature, so the roster and the titles
 * a group works on are visible without signing in. The controls a viewer sees
 * depend on `viewerRole`, which the API returns with the group so the page needs
 * no second request to decide what to render.
 */

import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { BadgeCheck, ExternalLink, Film, Plus, Settings, Users } from 'lucide-vue-next'
import {
  TranslatorRole,
  hasAtLeastTranslatorRole,
  type TranslatorGroupDetail
} from '@playanime/contracts'
import { AbortError, ApiError, translatorsApi } from '@/api'
import { toAnimeCardModelFromEntry } from '@/models'
import { useApiError } from '@/composables/useApiError'
import { useLocale } from '@/composables/useLocale'
import { usePageTitle } from '@/composables/usePageTitle'
import { useToast } from '@/composables/useToast'
import { useAuthStore } from '@/store/auth'
import Card from '@/components/ui/Card.vue'
import Button from '@/components/ui/Button.vue'
import AnimeGrid from '@/components/shared/AnimeGrid.vue'

const route = useRoute('/translator/[slug]')
const router = useRouter()
const { t, locale } = useLocale()
const { translateError } = useApiError()
const toast = useToast()
const authStore = useAuthStore()

const group = ref<TranslatorGroupDetail | null>(null)
const loading = ref(true)
const notFound = ref(false)
const applying = ref(false)
const avatarLoaded = ref(false)

let controller: AbortController | null = null

usePageTitle(() => group.value?.name ?? t('common.loading'))

/** Leaders administer the group; the dashboard link is shown only to them. */
const canManage = computed(() => {
  const role = group.value?.viewerRole
  return role !== null && role !== undefined && hasAtLeastTranslatorRole(role, TranslatorRole.EDITOR)
})

const isMember = computed(() => group.value?.viewerRole != null)

const canApply = computed(
  () =>
    group.value !== null &&
    group.value.isRecruiting &&
    !isMember.value &&
    !group.value.viewerHasPendingApplication &&
    authStore.isAuthenticated
)

const titles = computed(() =>
  (group.value?.titles ?? []).map((item) => toAnimeCardModelFromEntry(item.entry, item.seriesSlug, locale.value))
)

const createdYear = computed(() =>
  group.value === null ? '' : String(new Date(group.value.createdAt).getFullYear())
)

async function load(slug: string): Promise<void> {
  controller?.abort()
  const request = new AbortController()
  controller = request

  loading.value = true
  notFound.value = false
  avatarLoaded.value = false

  try {
    const result = await translatorsApi.bySlug(slug, request.signal)
    if (request.signal.aborted) return
    group.value = result
  } catch (cause: unknown) {
    if (AbortError.is(cause)) return

    group.value = null
    // A suspended group also answers 404 publicly, which is the intent.
    notFound.value = ApiError.is(cause) && cause.status === 404

    if (!notFound.value) toast.error(translateError(cause))
  } finally {
    if (controller === request) {
      loading.value = false
      controller = null
    }
  }
}

onMounted(() => {
  void load(route.params.slug)
})

watch(
  () => route.params.slug,
  (slug) => {
    if (typeof slug === 'string') void load(slug)
  }
)

onUnmounted(() => {
  controller?.abort()
})

async function apply(): Promise<void> {
  const current = group.value
  if (current === null || applying.value) return

  applying.value = true

  try {
    await translatorsApi.apply(current.slug, {})
    toast.success(t('translator.applicationSent'))
    await load(current.slug)
  } catch (cause: unknown) {
    toast.error(translateError(cause))
  } finally {
    applying.value = false
  }
}
</script>

<template>
  <div class="translator-page container mx-auto px-4 py-8">
    <!-- Loading -->
    <Card v-if="loading" variant="glass" class="p-6 animate-pulse">
      <div class="flex gap-6">
        <div class="w-32 h-32 rounded-lg bg-white/10"></div>
        <div class="flex-1 space-y-3">
          <div class="h-8 bg-white/10 rounded w-1/3"></div>
          <div class="h-4 bg-white/10 rounded w-2/3"></div>
        </div>
      </div>
    </Card>

    <div v-else-if="notFound" class="text-center py-24">
      <h1 class="text-3xl font-bold text-text-primary mb-4">{{ t('errors.notFound') }}</h1>
      <router-link to="/translators" class="text-primary hover:text-primary-hover font-semibold">
        {{ t('translator.allTranslators') }}
      </router-link>
    </div>

    <template v-else-if="group">
      <!-- Header -->
      <Card variant="glass" class="mb-8">
        <div class="flex flex-col md:flex-row gap-6">
          <div class="relative w-32 h-32 rounded-lg overflow-hidden shrink-0 bg-dark-800">
            <div
              v-if="group.avatar && !avatarLoaded"
              class="absolute inset-0 bg-dark-800 animate-pulse"
            />
            <img
              v-if="group.avatar"
              :src="group.avatar.url"
              :alt="group.name"
              :class="[
                'w-full h-full object-cover transition-opacity duration-300',
                { 'opacity-0': !avatarLoaded, 'opacity-100': avatarLoaded }
              ]"
              @load="avatarLoaded = true"
              @error="avatarLoaded = true"
            />
            <div v-else class="absolute inset-0 flex items-center justify-center">
              <Users :size="48" class="text-text-muted opacity-50" />
            </div>
          </div>

          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-3 mb-2 flex-wrap">
              <h1 class="text-3xl font-bold text-text-primary">{{ group.name }}</h1>

              <BadgeCheck
                v-if="group.isVerified"
                :size="22"
                class="text-accent-cyan"
                :title="t('admin.dashboard.manage.translators.verified')"
              />

              <span
                v-if="group.isRecruiting"
                class="px-3 py-1 rounded-full text-xs bg-primary/20 text-primary"
              >
                {{ t('translator.recruiting') }}
              </span>
            </div>

            <p v-if="group.description" class="text-text-secondary mb-4 whitespace-pre-line">
              {{ group.description }}
            </p>

            <div class="flex items-center gap-6 text-sm text-text-secondary flex-wrap mb-4">
              <span class="flex items-center gap-1">
                <Users :size="16" class="text-primary" />
                {{ group.memberCount }} {{ t('translator.members') }}
              </span>
              <span class="flex items-center gap-1">
                <Film :size="16" class="text-accent-cyan" />
                {{ group.entryCount }} {{ t('common.anime') }}
              </span>
              <span>{{ t('profile.memberSince') }} {{ createdYear }}</span>
            </div>

            <div class="flex gap-2 flex-wrap">
              <a
                v-if="group.websiteUrl"
                :href="group.websiteUrl"
                target="_blank"
                rel="noopener noreferrer"
                class="flex items-center gap-1 px-3 py-1.5 glass-light rounded-lg text-sm hover:glass-medium transition-smooth"
              >
                <ExternalLink :size="14" />
                {{ t('admin.dashboard.website') }}
              </a>
              <a
                v-if="group.discordUrl"
                :href="group.discordUrl"
                target="_blank"
                rel="noopener noreferrer"
                class="flex items-center gap-1 px-3 py-1.5 glass-light rounded-lg text-sm hover:glass-medium transition-smooth"
              >
                <ExternalLink :size="14" />
                Discord
              </a>
            </div>
          </div>

          <div class="flex flex-col gap-2 shrink-0">
            <Button
              v-if="canManage"
              variant="glass"
              @click="router.push(`/translator/dashboard/${group.slug}`)"
            >
              <Settings :size="18" />
              {{ t('translator.settings') }}
            </Button>

            <Button v-if="canApply" variant="primary" :disabled="applying" @click="apply">
              {{ applying ? t('common.loading') : t('translator.applyToJoin') }}
            </Button>

            <p
              v-else-if="group.viewerHasPendingApplication"
              class="text-sm text-text-muted max-w-40"
            >
              {{ t('translator.applicationPending') }}
            </p>
          </div>
        </div>
      </Card>

      <!-- Members -->
      <section class="mb-10">
        <h2 class="text-2xl font-bold text-text-primary mb-4">{{ t('translator.members') }}</h2>

        <div v-if="group.members.length > 0" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          <Card
            v-for="member in group.members"
            :key="member.userId"
            variant="flat"
            padding="sm"
            class="flex items-center gap-3"
          >
            <img
              v-if="member.avatar"
              :src="member.avatar"
              :alt="member.username"
              class="w-10 h-10 rounded-full object-cover shrink-0"
            />
            <div
              v-else
              class="w-10 h-10 rounded-full bg-dark-700 flex items-center justify-center text-text-muted font-semibold shrink-0"
            >
              {{ member.username.charAt(0).toUpperCase() }}
            </div>

            <div class="min-w-0">
              <router-link
                :to="`/profile/${member.username}`"
                class="font-medium text-text-primary hover:text-primary transition-colors block truncate"
              >
                {{ member.displayName ?? member.username }}
              </router-link>
              <p class="text-xs text-text-muted">
                {{ t(`translator.roles.${member.role}`) }}
                <template v-if="member.creditNote"> · {{ member.creditNote }}</template>
              </p>
            </div>
          </Card>
        </div>

        <p v-else class="text-text-secondary">{{ t('translator.noMembers') }}</p>
      </section>

      <!-- Titles -->
      <section>
        <div class="flex items-center justify-between gap-4 mb-4 flex-wrap">
          <h2 class="text-2xl font-bold text-text-primary">{{ t('translator.titles') }}</h2>

          <!--
            Editors and above may add or claim a title on the group's behalf.
            Routed through the ordinary catalogue create flow with this group
            pre-selected, rather than a separate form — there is only one way
            to create a title, and it already knows how to attribute a group.
          -->
          <router-link
            v-if="canManage"
            :to="{ path: '/catalogue/create', query: { groupId: group.id } }"
            class="flex items-center gap-2 px-3 py-1.5 glass-medium rounded-lg text-sm hover:glass-strong transition-smooth"
          >
            <Plus :size="16" />
            {{ t('catalogue.createTitle') }}
          </router-link>
        </div>

        <AnimeGrid
          v-if="titles.length > 0"
          :anime-list="titles"
          :columns="{ default: 2, md: 3, lg: 4, xl: 5 }"
        />

        <div v-else class="text-center py-8">
          <p class="text-text-secondary mb-3">{{ t('translator.noTitles') }}</p>
          <router-link
            v-if="canManage"
            :to="{ path: '/catalogue/create', query: { groupId: group.id } }"
            class="text-primary hover:underline text-sm"
          >
            {{ t('catalogue.createTitle') }}
          </router-link>
        </div>
      </section>
    </template>
  </div>
</template>
