<script setup lang="ts">
/**
 * Translator group dashboard.
 *
 * Administered by the group's own leaders, not by platform staff: authorization
 * here is `viewerRole`, which the API returns with the group. A site
 * administrator is not automatically a group leader, and the server enforces
 * that regardless of what this page renders.
 *
 * The three previous components (settings, members, titles) are folded into one
 * view because they all operate on the same loaded group and each re-fetch
 * returns the whole detail — keeping them apart meant three copies of the same
 * state and three chances for them to disagree.
 */

import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Check, Flag, Plus, Settings, Trash2, Users, X } from 'lucide-vue-next'
import {
  TRANSLATOR_ROLES,
  TranslatorRole,
  hasAtLeastTranslatorRole,
  type EpisodeReportDto,
  type TranslatorApplicationDto,
  type TranslatorGroupDetail
} from '@playanime/contracts'
import { AbortError, ApiError, animeApi, episodeReportsApi, translatorsApi } from '@/api'
import { useApiError } from '@/composables/useApiError'
import { useConfirm } from '@/composables/useConfirm'
import { useLocale } from '@/composables/useLocale'
import { usePageTitle } from '@/composables/usePageTitle'
import { useToast } from '@/composables/useToast'
import Card from '@/components/ui/Card.vue'
import Input from '@/components/ui/Input.vue'
import Textarea from '@/components/ui/Textarea.vue'
import Select from '@/components/ui/Select.vue'
import Button from '@/components/ui/Button.vue'

definePage({
  meta: {
    requiresAuth: true
  }
})

const route = useRoute('/translator/dashboard/[slug]')
const router = useRouter()
const { t } = useLocale()
const { translateError } = useApiError()
const { confirm } = useConfirm()
const toast = useToast()

type Tab = 'settings' | 'members' | 'titles' | 'applications' | 'reports'

const group = ref<TranslatorGroupDetail | null>(null)
const applications = ref<TranslatorApplicationDto[]>([])
const loading = ref(true)
const activeTab = ref<Tab>('settings')
const saving = ref(false)

let controller: AbortController | null = null

usePageTitle(() => group.value?.name ?? t('common.loading'))

const isLeader = computed(
  () =>
    group.value?.viewerRole != null &&
    hasAtLeastTranslatorRole(group.value.viewerRole, TranslatorRole.LEADER)
)

const canEdit = computed(
  () =>
    group.value?.viewerRole != null &&
    hasAtLeastTranslatorRole(group.value.viewerRole, TranslatorRole.EDITOR)
)

const tabs = computed(() =>
  [
    { id: 'settings' as const, label: t('translator.settings'), visible: isLeader.value },
    { id: 'members' as const, label: t('translator.members'), visible: true },
    { id: 'titles' as const, label: t('translator.titles'), visible: canEdit.value },
    { id: 'applications' as const, label: t('translator.applications'), visible: isLeader.value },
    { id: 'reports' as const, label: t('episodeReports.groupTabLabel'), visible: isLeader.value }
  ].filter((tab) => tab.visible)
)

const roleOptions = computed(() =>
  TRANSLATOR_ROLES.map((role) => ({ label: t(`translator.roles.${role}`), value: role }))
)

/* -------------------------------------------------------------------------- */
/* Loading                                                                     */
/* -------------------------------------------------------------------------- */

/** Settings form state, seeded from the group each time it loads. */
const form = ref({
  description: '',
  websiteUrl: '',
  discordUrl: '',
  avatarUrl: '',
  bannerUrl: '',
  isRecruiting: false
})

function seedForm(detail: TranslatorGroupDetail): void {
  form.value = {
    description: detail.description ?? '',
    websiteUrl: detail.websiteUrl ?? '',
    discordUrl: detail.discordUrl ?? '',
    avatarUrl: detail.avatar?.url ?? '',
    bannerUrl: detail.banner?.url ?? '',
    isRecruiting: detail.isRecruiting
  }
}

async function load(slug: string): Promise<void> {
  controller?.abort()
  const request = new AbortController()
  controller = request
  loading.value = true

  try {
    const detail = await translatorsApi.bySlug(slug, request.signal)
    if (request.signal.aborted) return

    group.value = detail
    seedForm(detail)

    // Anyone below editor has no business on this page at all.
    if (detail.viewerRole === null) {
      toast.error(t('errors.forbidden'))
      await router.push({ name: '/translator/[slug]', params: { slug } })
      return
    }

    if (!isLeader.value) activeTab.value = 'members'
    else {
      void loadApplications(slug)
      void loadReports()
    }
  } catch (cause: unknown) {
    if (AbortError.is(cause)) return
    group.value = null
    if (ApiError.is(cause) && cause.status === 404) await router.push({ name: '/translators' })
    else toast.error(translateError(cause))
  } finally {
    if (controller === request) {
      loading.value = false
      controller = null
    }
  }
}

async function loadApplications(slug: string): Promise<void> {
  try {
    const page = await translatorsApi.applications(slug, { status: 'pending', limit: 50 })
    applications.value = page.items
  } catch (cause: unknown) {
    if (!AbortError.is(cause)) console.error('Failed to load applications:', cause)
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

/** Applies a mutation and refreshes from its response. */
async function mutate(work: () => Promise<TranslatorGroupDetail>): Promise<void> {
  saving.value = true

  try {
    const detail = await work()
    group.value = detail
    seedForm(detail)
    toast.success(t('translator.saved'))
  } catch (cause: unknown) {
    toast.error(translateError(cause))
  } finally {
    saving.value = false
  }
}

/* -------------------------------------------------------------------------- */
/* Settings                                                                    */
/* -------------------------------------------------------------------------- */

function saveSettings(): void {
  const current = group.value
  if (current === null) return

  // Empty strings clear the field; the contract models that as null.
  const orNull = (value: string): string | null => (value.trim().length === 0 ? null : value.trim())

  void mutate(() =>
    translatorsApi.update(current.slug, {
      description: orNull(form.value.description),
      websiteUrl: orNull(form.value.websiteUrl),
      discordUrl: orNull(form.value.discordUrl),
      avatarUrl: orNull(form.value.avatarUrl),
      bannerUrl: orNull(form.value.bannerUrl),
      isRecruiting: form.value.isRecruiting
    })
  )
}

/**
 * Disbands the group permanently. Soft delete server-side: membership and
 * title-credit history survive so existing attribution does not vanish, but
 * the group's own page and directory listing are gone for good — hence the
 * confirmation, which names the group so a leader of several groups cannot
 * click through the wrong one by habit.
 */
async function disbandGroup(): Promise<void> {
  const current = group.value
  if (current === null) return

  const confirmed = await confirm({
    title: t('translator.disbandConfirmTitle'),
    message: t('translator.disbandConfirmMessage', { name: current.name }),
    confirmText: t('translator.disband'),
    cancelText: t('common.cancel'),
    confirmVariant: 'danger'
  })
  if (!confirmed) return

  saving.value = true

  try {
    await translatorsApi.disband(current.slug)
    toast.success(t('translator.disbanded'))
    await router.push({ name: '/translators' })
  } catch (cause: unknown) {
    toast.error(translateError(cause))
  } finally {
    saving.value = false
  }
}

/* -------------------------------------------------------------------------- */
/* Members                                                                     */
/* -------------------------------------------------------------------------- */

const inviteUsername = ref('')
const inviteRole = ref<TranslatorRole>(TranslatorRole.MEMBER)

function addMember(): void {
  const current = group.value
  if (current === null || inviteUsername.value.trim().length === 0) return

  void mutate(async () => {
    const detail = await translatorsApi.addMember(current.slug, {
      username: inviteUsername.value.trim(),
      role: inviteRole.value
    })
    inviteUsername.value = ''
    return detail
  })
}

function changeRole(userId: string, role: TranslatorRole): void {
  const current = group.value
  if (current === null) return
  void mutate(() => translatorsApi.updateMember(current.slug, userId, { role }))
}

async function removeMember(userId: string, username: string): Promise<void> {
  const current = group.value
  if (current === null) return

  const confirmed = await confirm({
    message: t('translator.confirmRemoveMember', { username }),
    confirmText: t('common.delete'),
    cancelText: t('common.cancel'),
    confirmVariant: 'danger'
  })

  if (!confirmed) return

  try {
    await translatorsApi.removeMember(current.slug, userId)
    toast.success(t('translator.saved'))
    await load(current.slug)
  } catch (cause: unknown) {
    // The server refuses to remove the last leader; its message says why.
    toast.error(translateError(cause))
  }
}

/* -------------------------------------------------------------------------- */
/* Titles                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * A search finds Series (that's what `GET /anime` indexes), but a claim is
 * on a specific Entry — a season, movie, OVA. For the common single-entry
 * series this is transparent: picking a search result resolves its main
 * entry behind the scenes. A series with several entries shows a second
 * picker so the group claims the right one, not just whichever happened to
 * be main.
 */
const titleQuery = ref('')
const titleResults = ref<{ slug: string; title: string }[]>([])
const episodeRange = ref('')
const searching = ref(false)
/** Distinguishes "haven't searched yet" from "searched and found nothing" — typing alone must not claim a title is missing. */
const hasSearched = ref(false)

/** Set once a series is picked from search results — the second step resolves which of its entries to claim. */
const pickedSeriesSlug = ref<string | null>(null)
const pickedSeriesTitle = ref<string>('')
const entryChoices = ref<{ id: string; title: string; isMainEntry: boolean }[]>([])
const resolvingEntries = ref(false)

async function searchTitles(): Promise<void> {
  const term = titleQuery.value.trim()
  if (term.length < 2) {
    titleResults.value = []
    return
  }

  searching.value = true

  try {
    const page = await animeApi.list({ search: term, limit: 8 })
    titleResults.value = page.items.map((item) => ({
      slug: item.slug,
      title: item.title
    }))
    hasSearched.value = true
  } catch (cause: unknown) {
    if (!AbortError.is(cause)) {
      titleResults.value = []
      hasSearched.value = true
    }
  } finally {
    searching.value = false
  }
}

// A search is only valid for the query it ran against; editing the field
// afterwards must hide both the stale results and the stale "not found" hint.
watch(titleQuery, () => {
  hasSearched.value = false
})

/** Picking a series loads its entries so the group can claim the right release. */
async function pickSeries(slug: string, title: string): Promise<void> {
  pickedSeriesSlug.value = slug
  pickedSeriesTitle.value = title
  entryChoices.value = []
  resolvingEntries.value = true

  try {
    const detail = await animeApi.bySlug(slug)
    entryChoices.value = detail.entries.map((entry) => ({
      id: entry.id,
      title: entry.titles.romaji,
      isMainEntry: entry.isMainEntry
    }))

    // The common case: exactly one entry, so there is nothing to actually
    // pick — claim it immediately rather than showing a picker of one.
    if (entryChoices.value.length === 1) {
      const only = entryChoices.value[0]
      if (only !== undefined) addTitle(only.id)
    }
  } catch (cause: unknown) {
    if (!AbortError.is(cause)) toast.error(translateError(cause))
  } finally {
    resolvingEntries.value = false
  }
}

function cancelPick(): void {
  pickedSeriesSlug.value = null
  pickedSeriesTitle.value = ''
  entryChoices.value = []
}

function addTitle(entryId: string): void {
  const current = group.value
  if (current === null) return

  void mutate(async () => {
    const detail = await translatorsApi.addTitle(current.slug, {
      entryId,
      ...(episodeRange.value.trim().length > 0 ? { episodeRange: episodeRange.value.trim() } : {})
    })
    titleQuery.value = ''
    titleResults.value = []
    episodeRange.value = ''
    hasSearched.value = false
    cancelPick()
    return detail
  })
}

async function removeTitle(entryId: string): Promise<void> {
  const current = group.value
  if (current === null) return

  try {
    await translatorsApi.removeTitle(current.slug, entryId)
    await load(current.slug)
  } catch (cause: unknown) {
    toast.error(translateError(cause))
  }
}

/* -------------------------------------------------------------------------- */
/* Applications                                                                */
/* -------------------------------------------------------------------------- */

async function decide(application: TranslatorApplicationDto, accept: boolean): Promise<void> {
  const current = group.value
  if (current === null) return

  try {
    await translatorsApi.decideApplication(current.slug, application.id, {
      accept,
      ...(accept ? { role: TranslatorRole.MEMBER } : {})
    })
    toast.success(t('translator.saved'))
    await load(current.slug)
  } catch (cause: unknown) {
    toast.error(translateError(cause))
  }
}

/* -------------------------------------------------------------------------- */
/* Episode reports — only for episodes this group is credited on              */
/* -------------------------------------------------------------------------- */

const reports = ref<EpisodeReportDto[]>([])
const resolvingReportId = ref<string | null>(null)

async function loadReports(): Promise<void> {
  const current = group.value
  if (current === null) return

  try {
    reports.value = await episodeReportsApi.forGroup(current.id)
  } catch (cause: unknown) {
    if (!AbortError.is(cause)) console.error('Failed to load episode reports:', cause)
  }
}

async function resolveReport(report: EpisodeReportDto, status: 'action_taken' | 'dismissed'): Promise<void> {
  const current = group.value
  if (current === null) return

  resolvingReportId.value = report.id

  try {
    await episodeReportsApi.resolve(report.id, { status }, current.id)
    toast.success(t('translator.saved'))
    await loadReports()
  } catch (cause: unknown) {
    toast.error(translateError(cause))
  } finally {
    resolvingReportId.value = null
  }
}
</script>

<template>
  <div class="translator-dashboard container mx-auto px-4 py-8 max-w-5xl">
    <Card v-if="loading" variant="glass" class="p-6 animate-pulse">
      <div class="h-8 bg-white/10 rounded w-1/3 mb-4"></div>
      <div class="h-4 bg-white/10 rounded w-2/3"></div>
    </Card>

    <template v-else-if="group">
      <div class="flex items-center justify-between mb-8 flex-wrap gap-4">
        <div>
          <h1 class="text-3xl font-bold text-text-primary">{{ group.name }}</h1>
          <p class="text-text-secondary">{{ t('translator.settings') }}</p>
        </div>
        <Button variant="ghost" @click="router.push(`/translator/${group.slug}`)">
          {{ t('common.view') }}
        </Button>
      </div>

      <!-- Tabs -->
      <div class="glass-medium rounded-lg p-1 inline-flex gap-1 mb-6 flex-wrap">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          type="button"
          class="px-4 py-2 rounded-md text-sm font-medium transition-smooth"
          :class="[
            activeTab === tab.id
              ? 'bg-primary text-white'
              : 'text-text-secondary hover:text-text-primary hover:bg-white/10'
          ]"
          @click="activeTab = tab.id"
        >
          {{ tab.label }}
        </button>
      </div>

      <!-- Settings -->
      <Card v-if="activeTab === 'settings'" variant="glass">
        <form class="space-y-5" @submit.prevent="saveSettings">
          <div>
            <label class="block text-sm font-medium text-text-primary mb-2">
              {{ t('anime.synopsis') }}
            </label>
            <Textarea v-model="form.description" :rows="4" variant="glass" />
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-medium text-text-primary mb-2">
                {{ t('admin.dashboard.website') }}
              </label>
              <Input v-model="form.websiteUrl" type="url" variant="glass" />
            </div>
            <div>
              <label class="block text-sm font-medium text-text-primary mb-2">Discord</label>
              <Input v-model="form.discordUrl" type="url" variant="glass" />
            </div>
            <div>
              <label class="block text-sm font-medium text-text-primary mb-2">Avatar URL</label>
              <Input v-model="form.avatarUrl" type="url" variant="glass" />
            </div>
            <div>
              <label class="block text-sm font-medium text-text-primary mb-2">Banner URL</label>
              <Input v-model="form.bannerUrl" type="url" variant="glass" />
            </div>
          </div>

          <label class="flex items-center gap-2 text-sm text-text-secondary">
            <input v-model="form.isRecruiting" type="checkbox" class="accent-primary" />
            {{ t('translator.recruiting') }}
          </label>

          <div class="flex justify-end">
            <Button variant="primary" type="submit" :disabled="saving">
              <Settings :size="18" />
              {{ saving ? t('common.saving') : t('common.save') }}
            </Button>
          </div>
        </form>

        <div class="mt-8 pt-6 border-t border-red-500/20">
          <h3 class="text-sm font-semibold text-red-400 mb-1">{{ t('translator.dangerZone') }}</h3>
          <p class="text-xs text-text-muted mb-3">{{ t('translator.disbandHint') }}</p>
          <Button
            variant="ghost"
            size="sm"
            class="text-red-400! hover:bg-red-500/10!"
            :disabled="saving"
            @click="disbandGroup"
          >
            <Trash2 :size="16" />
            {{ t('translator.disband') }}
          </Button>
        </div>
      </Card>

      <!-- Members -->
      <div v-else-if="activeTab === 'members'" class="space-y-4">
        <Card v-if="isLeader" variant="glass" class="p-4">
          <div class="flex flex-col md:flex-row gap-3">
            <Input
              v-model="inviteUsername"
              :placeholder="t('auth.username')"
              class="flex-1"
              variant="glass"
            />
            <Select v-model="inviteRole" :options="roleOptions" />
            <Button
              variant="primary"
              :disabled="saving || inviteUsername.trim().length === 0"
              @click="addMember"
            >
              <Plus :size="18" />
              {{ t('translator.addMember') }}
            </Button>
          </div>
        </Card>

        <Card
          v-for="member in group.members"
          :key="member.userId"
          variant="glass"
          class="p-4 flex items-center justify-between gap-4 flex-wrap"
        >
          <div class="flex items-center gap-3 min-w-0">
            <img
              v-if="member.avatar"
              :src="member.avatar"
              :alt="member.username"
              class="w-10 h-10 rounded-full object-cover shrink-0"
            />
            <div
              v-else
              class="w-10 h-10 rounded-full bg-dark-700 flex items-center justify-center text-text-muted shrink-0"
            >
              {{ member.username.charAt(0).toUpperCase() }}
            </div>

            <div class="min-w-0">
              <p class="font-medium text-text-primary truncate">
                {{ member.displayName ?? member.username }}
              </p>
              <p class="text-xs text-text-muted">@{{ member.username }}</p>
            </div>
          </div>

          <div v-if="isLeader" class="flex items-center gap-2 shrink-0">
            <Select
              :model-value="member.role"
              :options="roleOptions"
              size="sm"
              @update:model-value="(role: TranslatorRole) => changeRole(member.userId, role)"
            />
            <Button
              variant="ghost"
              size="sm"
              @click="removeMember(member.userId, member.username)"
            >
              <Trash2 :size="16" />
            </Button>
          </div>

          <span v-else class="text-sm text-text-muted">
            {{ t(`translator.roles.${member.role}`) }}
          </span>
        </Card>
      </div>

      <!-- Titles -->
      <div v-else-if="activeTab === 'titles'" class="space-y-4">
        <Card variant="glass" class="p-4 space-y-3">
          <div class="flex flex-col md:flex-row gap-3">
            <div class="min-w-0 flex-1">
              <Input
                v-model="titleQuery"
                :placeholder="t('search.placeholder')"
                variant="glass"
                @keyup.enter="searchTitles"
              />
            </div>
            <div class="min-w-0 md:w-48 md:shrink-0">
              <Input
                v-model="episodeRange"
                :placeholder="t('translator.episodeRange')"
                variant="glass"
              />
            </div>
            <Button variant="glass" class="shrink-0 whitespace-nowrap" :disabled="searching" @click="searchTitles">
              {{ searching ? t('common.loading') : t('common.search') }}
            </Button>
          </div>

          <div v-if="titleResults.length > 0" class="space-y-2">
            <button
              v-for="result in titleResults"
              :key="result.slug"
              type="button"
              class="w-full text-left px-3 py-2 rounded-lg glass-light hover:glass-medium transition-smooth flex items-center justify-between"
              @click="pickSeries(result.slug, result.title)"
            >
              <span class="text-text-primary">{{ result.title }}</span>
              <Plus :size="16" class="text-primary" />
            </button>
          </div>

          <!--
            Only shown once a search has actually run and come back empty —
            otherwise this appeared on every keystroke, before the user had
            even searched, and looked like the search was broken.
          -->
          <p v-else-if="hasSearched" class="text-xs text-text-muted">
            {{ t('search.noResults') }}
            ·
            {{ t('translator.titleNotFoundHint') }}
            <router-link
              :to="{ path: '/catalogue/create', query: { groupId: group?.id } }"
              class="text-primary hover:underline"
            >
              {{ t('catalogue.createTitle') }}
            </router-link>
          </p>

          <!--
            Second step: a series with more than one entry (several
            seasons, an OVA, ...) needs the group to say which release it's
            claiming, not just whichever happens to be main.
          -->
          <div v-if="pickedSeriesSlug !== null && entryChoices.length > 1" class="space-y-2 pt-2 border-t border-white/10">
            <p class="text-sm text-text-secondary">
              {{ t('translator.pickEntry') }} — <span class="text-text-primary font-medium">{{ pickedSeriesTitle }}</span>
            </p>
            <button
              v-for="choice in entryChoices"
              :key="choice.id"
              type="button"
              class="w-full text-left px-3 py-2 rounded-lg glass-light hover:glass-medium transition-smooth flex items-center justify-between"
              @click="addTitle(choice.id)"
            >
              <span class="text-text-primary">{{ choice.title }}</span>
              <Plus :size="16" class="text-primary" />
            </button>
            <Button variant="ghost" size="sm" @click="cancelPick">{{ t('common.cancel') }}</Button>
          </div>
          <p v-else-if="resolvingEntries" class="text-xs text-text-muted">{{ t('common.loading') }}</p>
        </Card>

        <Card
          v-for="item in group.titles"
          :key="item.entry.id"
          variant="glass"
          class="p-4 flex items-center justify-between gap-4"
        >
          <div class="min-w-0">
            <p class="font-medium text-text-primary truncate">
              {{ item.entry.titles.romaji }}
            </p>
            <p v-if="item.episodeRange" class="text-xs text-text-muted">
              {{ t('translator.episodeRange') }}: {{ item.episodeRange }}
            </p>
          </div>

          <Button variant="ghost" size="sm" @click="removeTitle(item.entry.id)">
            <Trash2 :size="16" />
          </Button>
        </Card>

        <p v-if="group.titles.length === 0" class="text-center text-text-secondary py-8">
          {{ t('translator.noTitles') }}
        </p>
      </div>

      <!-- Applications -->
      <div v-else-if="activeTab === 'applications'" class="space-y-3">
        <Card
          v-for="application in applications"
          :key="application.id"
          variant="glass"
          class="p-4 flex items-start justify-between gap-4 flex-wrap"
        >
          <div class="flex items-start gap-3 min-w-0">
            <Users :size="20" class="text-text-muted mt-1 shrink-0" />
            <div class="min-w-0">
              <p class="font-medium text-text-primary">
                {{ application.displayName ?? application.username }}
              </p>
              <p v-if="application.message" class="text-sm text-text-secondary mt-1">
                {{ application.message }}
              </p>
            </div>
          </div>

          <div class="flex gap-2 shrink-0">
            <Button variant="primary" size="sm" @click="decide(application, true)">
              <Check :size="16" />
              {{ t('translator.accept') }}
            </Button>
            <Button variant="ghost" size="sm" @click="decide(application, false)">
              <X :size="16" />
              {{ t('translator.reject') }}
            </Button>
          </div>
        </Card>

        <p v-if="applications.length === 0" class="text-center text-text-secondary py-8">
          {{ t('translator.noApplications') }}
        </p>
      </div>

      <!-- Episode reports — only for episodes this group is credited on -->
      <div v-else class="space-y-3">
        <Card
          v-for="report in reports"
          :key="report.id"
          variant="glass"
          class="p-4 space-y-2"
        >
          <div class="flex items-start justify-between gap-4 flex-wrap">
            <div class="flex items-start gap-3 min-w-0">
              <Flag :size="20" class="text-text-muted mt-1 shrink-0" />
              <div class="min-w-0">
                <p class="font-medium text-text-primary">
                  {{ report.animeTitle }} — {{ t('anime.episode') }} {{ report.episodeNumber }}
                </p>
                <p class="text-sm text-text-secondary mt-1">
                  {{ t(`episodeReports.reasons.${report.reason}`) }}
                </p>
                <p v-if="report.description" class="text-sm text-text-muted mt-1">
                  {{ report.description }}
                </p>
                <p class="text-xs text-text-muted mt-1">
                  {{ t('episodeReports.reportedBy', { username: report.reporterUsername }) }}
                </p>
              </div>
            </div>

            <span
              class="shrink-0 px-2 py-0.5 rounded-full text-xs font-medium"
              :class="
                report.status === 'open'
                  ? 'bg-primary/20 text-primary'
                  : report.status === 'action_taken'
                    ? 'bg-green-500/20 text-green-400'
                    : 'bg-white/10 text-text-muted'
              "
            >
              {{ t(`episodeReports.statuses.${report.status}`) }}
            </span>
          </div>

          <div v-if="report.status === 'open'" class="flex gap-2 pt-1">
            <Button
              variant="primary"
              size="sm"
              :disabled="resolvingReportId === report.id"
              @click="resolveReport(report, 'action_taken')"
            >
              <Check :size="16" />
              {{ t('episodeReports.markFixed') }}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              :disabled="resolvingReportId === report.id"
              @click="resolveReport(report, 'dismissed')"
            >
              <X :size="16" />
              {{ t('episodeReports.dismiss') }}
            </Button>
          </div>
        </Card>

        <p v-if="reports.length === 0" class="text-center text-text-secondary py-8">
          {{ t('episodeReports.groupEmpty') }}
        </p>
      </div>
    </template>
  </div>
</template>
