<script setup lang="ts">
/**
 * Administration — user management.
 *
 * Administrator-only, because these rows carry email addresses. Every
 * destructive action requires a reason: the API refuses one without it, and the
 * reason is what makes the audit row worth reading months later.
 *
 * The server refuses any action against a peer or superior, so the controls are
 * hidden for those rows rather than offered and then rejected.
 */

import { computed, onUnmounted, ref, watch } from 'vue'
import {
  AlertCircle,
  Ban,
  CheckCircle,
  Search,
  ShieldCheck,
  Undo2,
  XCircle
} from 'lucide-vue-next'
import {
  ROLE_RANK,
  USER_ROLES,
  UserRole,
  type AdminSanctionBody,
  type AdminUserDto
} from '@playanime/contracts'
import { AbortError, adminApi } from '@/api'
import { useApiError } from '@/composables/useApiError'
import { useLocale } from '@/composables/useLocale'
import { useToast } from '@/composables/useToast'
import { useAuthStore } from '@/store/auth'
import { roleLabel } from '@/utils/user'
import Card from '@/components/ui/Card.vue'
import Input from '@/components/ui/Input.vue'
import Select from '@/components/ui/Select.vue'
import Button from '@/components/ui/Button.vue'
import Modal from '@/components/ui/Modal/Modal.vue'
import Textarea from '@/components/ui/Textarea.vue'

const { t } = useLocale()
const { translateError } = useApiError()
const toast = useToast()
const authStore = useAuthStore()

const users = ref<AdminUserDto[]>([])
const loading = ref(true)
const loadingMore = ref(false)
const hasMore = ref(false)

const searchQuery = ref('')
const roleFilter = ref('')
const suspendedOnly = ref(false)

let cursor: string | null = null
let controller: AbortController | null = null
let debounceTimer: ReturnType<typeof setTimeout> | null = null

const roleOptions = computed(() => [
  { label: t('admin.dashboard.allUsers'), value: '' },
  ...USER_ROLES.map((role) => ({ label: roleLabel(role), value: role }))
])

const statusOptions = computed(() => [
  { label: t('admin.dashboard.allUsers'), value: false },
  { label: t('admin.dashboard.suspendedUsers'), value: true }
])

/**
 * Whether the signed-in staff member outranks this row.
 *
 * Mirrors `assertOutranks` on the server: strictly greater, so two moderators
 * cannot act on each other and nobody can act on themselves.
 */
function canActOn(user: AdminUserDto): boolean {
  const actor = authStore.user
  if (actor === null || actor.id === user.id) return false
  return ROLE_RANK[actor.role] > ROLE_RANK[user.role]
}

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
    const page = await adminApi.users(
      {
        limit: 25,
        ...(searchQuery.value.trim().length > 0 ? { search: searchQuery.value.trim() } : {}),
        ...(roleFilter.value === '' ? {} : { role: roleFilter.value as UserRole }),
        ...(suspendedOnly.value ? { suspendedOnly: true } : {}),
        ...(append && cursor !== null ? { cursor } : {})
      },
      request.signal
    )

    if (request.signal.aborted) return

    users.value = append ? [...users.value, ...page.items] : page.items
    cursor = page.nextCursor
    hasMore.value = page.hasMore
  } catch (cause: unknown) {
    if (AbortError.is(cause)) return
    if (!append) users.value = []
    toast.error(translateError(cause))
  } finally {
    if (controller === request) {
      loading.value = false
      loadingMore.value = false
      controller = null
    }
  }
}

// Debounced: a request per keystroke would hammer a table scan behind ILIKE.
watch([searchQuery, roleFilter, suspendedOnly], () => {
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

const target = ref<AdminUserDto | null>(null)
const action = ref<'role' | 'sanction' | null>(null)
const reason = ref('')
const pendingRole = ref<UserRole>(UserRole.USER)
const sanctionKind = ref<AdminSanctionBody['kind']>('warning')
const durationDays = ref('7')
const submitting = ref(false)

/** Roles the actor may grant: strictly below their own. */
const grantableRoles = computed(() => {
  const actor = authStore.user
  if (actor === null) return []
  return USER_ROLES.filter((role) => ROLE_RANK[role] < ROLE_RANK[actor.role]).map((role) => ({
    label: roleLabel(role),
    value: role
  }))
})

const sanctionKinds = computed(() => [
  { label: t('admin.dashboard.sanction.warning'), value: 'warning' },
  { label: t('admin.dashboard.sanction.mute'), value: 'mute' },
  { label: t('admin.dashboard.sanction.suspension'), value: 'suspension' },
  { label: t('admin.dashboard.sanction.ban'), value: 'ban' }
])

/** A suspension must be bounded; the API rejects one without a duration. */
const requiresDuration = computed(() => sanctionKind.value === 'suspension')

function openRoleDialog(user: AdminUserDto): void {
  target.value = user
  action.value = 'role'
  pendingRole.value = user.role
  reason.value = ''
}

function openSanctionDialog(user: AdminUserDto): void {
  target.value = user
  action.value = 'sanction'
  sanctionKind.value = 'suspension'
  durationDays.value = '7'
  reason.value = ''
}

function closeDialog(): void {
  target.value = null
  action.value = null
  reason.value = ''
}

async function submit(): Promise<void> {
  const user = target.value
  if (user === null || reason.value.trim().length === 0) return

  submitting.value = true

  try {
    if (action.value === 'role') {
      await adminApi.updateRole(user.id, { role: pendingRole.value, reason: reason.value.trim() })
      toast.success(t('admin.dashboard.roleUpdated'))
    } else {
      const parsed = Number.parseInt(durationDays.value, 10)

      await adminApi.sanction(user.id, {
        kind: sanctionKind.value,
        reason: reason.value.trim(),
        ...(requiresDuration.value && Number.isFinite(parsed) ? { durationDays: parsed } : {})
      })
      toast.success(t('admin.dashboard.sanctionApplied'))
    }

    closeDialog()
    await load()
  } catch (cause: unknown) {
    toast.error(translateError(cause))
  } finally {
    submitting.value = false
  }
}

async function liftSanctions(user: AdminUserDto): Promise<void> {
  try {
    await adminApi.liftSanctions(user.id, 'Cofnięte przez administratora.')
    toast.success(t('admin.dashboard.sanctionLifted'))
    await load()
  } catch (cause: unknown) {
    toast.error(translateError(cause))
  }
}

function formatDate(value: string | null): string {
  return value === null ? '—' : new Date(value).toLocaleDateString()
}
</script>

<template>
  <div class="admin-users space-y-6">
    <div class="flex items-center justify-between">
      <h2 class="text-2xl font-bold text-text-primary">
        {{ t('admin.dashboard.sections.users') }}
      </h2>
    </div>

    <!-- Filters -->
    <Card variant="glass" class="p-4">
      <div class="flex flex-col md:flex-row gap-4">
        <div class="flex-1 relative">
          <Search :size="20" class="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
          <Input
            v-model="searchQuery"
            :placeholder="t('admin.dashboard.searchUsers')"
            class="pl-10 w-full"
          />
        </div>

        <Select v-model="roleFilter" :options="roleOptions" />
        <Select v-model="suspendedOnly" :options="statusOptions" />
      </div>
    </Card>

    <!-- Loading State -->
    <div v-if="loading" class="space-y-4">
      <Card v-for="i in 5" :key="i" variant="glass" class="p-6 animate-pulse">
        <div class="flex items-center gap-4">
          <div class="w-12 h-12 bg-white/10 rounded-full"></div>
          <div class="flex-1">
            <div class="h-4 bg-white/10 rounded w-1/3 mb-2"></div>
            <div class="h-3 bg-white/10 rounded w-1/4"></div>
          </div>
        </div>
      </Card>
    </div>

    <!-- Users List -->
    <div v-else-if="users.length > 0" class="space-y-3">
      <Card
        v-for="user in users"
        :key="user.id"
        variant="glass"
        class="p-6 hover:glass-strong transition-smooth"
      >
        <div class="flex flex-wrap items-center justify-between gap-4">
          <div class="flex items-center gap-4 flex-1 min-w-0">
            <img
              v-if="user.avatar"
              :src="user.avatar"
              :alt="user.username"
              class="w-12 h-12 rounded-full object-cover shrink-0"
            />
            <div
              v-else
              class="w-12 h-12 rounded-full bg-linear-to-br from-primary to-primary-hover flex items-center justify-center text-white font-semibold text-lg shrink-0"
            >
              {{ user.username.charAt(0).toUpperCase() }}
            </div>

            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 mb-1 flex-wrap">
                <h4 class="font-semibold text-text-primary">
                  {{ user.displayName ?? user.username }}
                </h4>
                <span class="text-text-muted text-sm">@{{ user.username }}</span>

                <CheckCircle v-if="user.emailVerified" :size="16" class="text-green-400" />
                <XCircle v-else :size="16" class="text-yellow-400" />

                <span
                  v-if="user.role !== 'user'"
                  class="px-2 py-0.5 rounded-full text-xs font-medium bg-primary/20 text-primary"
                >
                  {{ roleLabel(user.role) }}
                </span>

                <span
                  v-if="user.suspendedAt"
                  class="px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/20 text-red-400"
                >
                  {{ t('admin.dashboard.banned') }}
                </span>
              </div>

              <div class="flex items-center gap-4 text-sm text-text-secondary flex-wrap">
                <span>{{ user.email }}</span>
                <span>{{ t('profile.memberSince') }}: {{ formatDate(user.createdAt) }}</span>
              </div>

              <p v-if="user.suspensionReason" class="text-xs text-red-300 mt-1">
                {{ user.suspensionReason }}
                <template v-if="user.suspendedUntil">
                  ({{ t('admin.dashboard.until') }} {{ formatDate(user.suspendedUntil) }})
                </template>
              </p>
            </div>
          </div>

          <!-- Actions, shown only where the server would accept them. -->
          <div v-if="canActOn(user)" class="flex gap-2 shrink-0">
            <Button variant="glass" size="sm" @click="openRoleDialog(user)">
              <ShieldCheck :size="16" />
              {{ t('admin.dashboard.changeRole') }}
            </Button>

            <Button
              v-if="user.suspendedAt"
              variant="glass"
              size="sm"
              @click="liftSanctions(user)"
            >
              <Undo2 :size="16" />
              {{ t('admin.dashboard.lift') }}
            </Button>
            <Button v-else variant="ghost" size="sm" @click="openSanctionDialog(user)">
              <Ban :size="16" />
              {{ t('admin.dashboard.sanction.action') }}
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

    <!-- Action dialog -->
    <Modal :model-value="action !== null" @update:model-value="closeDialog">
      <div v-if="target" class="space-y-4 p-2">
        <h3 class="text-xl font-semibold text-text-primary">
          {{ action === 'role' ? t('admin.dashboard.changeRole') : t('admin.dashboard.sanction.action') }}
          — {{ target.username }}
        </h3>

        <div v-if="action === 'role'">
          <label class="block text-sm text-text-secondary mb-1">
            {{ t('admin.dashboard.role') }}
          </label>
          <Select v-model="pendingRole" :options="grantableRoles" />
        </div>

        <template v-else>
          <div>
            <label class="block text-sm text-text-secondary mb-1">
              {{ t('admin.dashboard.sanction.kind') }}
            </label>
            <Select v-model="sanctionKind" :options="sanctionKinds" />
          </div>

          <div v-if="requiresDuration">
            <label class="block text-sm text-text-secondary mb-1">
              {{ t('admin.dashboard.sanction.durationDays') }}
            </label>
            <Input v-model="durationDays" type="number" min="1" max="3650" />
          </div>
        </template>

        <div>
          <label class="block text-sm text-text-secondary mb-1">
            {{ t('admin.dashboard.reason') }}
          </label>
          <Textarea v-model="reason" :rows="3" :placeholder="t('admin.dashboard.reasonHint')" />
          <p class="text-xs text-text-muted mt-1 flex items-center gap-1">
            <AlertCircle :size="12" />
            {{ t('admin.dashboard.reasonRequired') }}
          </p>
        </div>

        <div class="flex justify-end gap-2 pt-2">
          <Button variant="ghost" @click="closeDialog">{{ t('common.cancel') }}</Button>
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
