<script setup lang="ts">
/**
 * Account flyout, opened from the sidebar's bottom button.
 *
 * The sidebar is icon-only and docked left, so there is no room there for a
 * username, avatar or a list of actions. This renders that as a panel that
 * opens to the right of the trigger instead of routing straight to a page,
 * so "sign out" or "open the group I lead" is one click instead of two.
 */

import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { LayoutDashboard, LogOut, Settings, User, Users } from 'lucide-vue-next'
import { UserRole, hasAtLeastRole } from '@playanime/contracts'
import { useLocale } from '@/composables/useLocale'
import { useCataloguePermissions } from '@/composables/useCataloguePermissions'
import { useAuthStore } from '@/store/auth'

interface Props {
  /**
   * Whether the panel is open. Kept as a prop rather than toggling this whole
   * component with `v-if` in the parent: the panel is `Teleport`ed, and a
   * `<transition>` around a `v-if` needs the *same* component instance to
   * stay mounted across the open/close change to play the leave transition —
   * destroying the whole component on close (the parent's old `v-if`) skips
   * straight past it.
   */
  open: boolean
  /**
   * Viewport coordinates of the trigger button, so the panel can be
   * positioned via `Teleport` rather than nested inside it. Anchored by
   * `bottom` rather than `top`: this is the sidebar's last item, so a panel
   * growing downward from the button's top would often run past the bottom
   * of the viewport.
   */
  anchor: { bottom: number; left: number }
  /** The trigger button, excluded from click-outside so re-clicking it does not close-then-reopen in the same event. */
  triggerEl?: HTMLElement | null
}

const props = withDefaults(defineProps<Props>(), {
  triggerEl: null
})

const emit = defineEmits<{
  close: []
}>()

const router = useRouter()
const { t } = useLocale()
const authStore = useAuthStore()
const { groups, load: loadPermissions } = useCataloguePermissions()

const style = computed(() => ({
  bottom: `${String(props.anchor.bottom)}px`,
  left: `${String(props.anchor.left)}px`
}))

function closeIfOutside(): void {
  emit('close')
}

// The flyout is often the first thing on a page to need group membership,
// e.g. on pages that never call useCataloguePermissions themselves.
onMounted(() => void loadPermissions())

const user = computed(() => authStore.user)

const initials = computed(() => {
  const name = user.value?.displayName ?? user.value?.username ?? ''
  return name.charAt(0).toUpperCase()
})

const isStaff = computed(
  () => user.value !== null && hasAtLeastRole(user.value.role, UserRole.MODERATOR)
)

function go(path: string): void {
  emit('close')
  void router.push(path)
}

function signOut(): void {
  emit('close')
  void authStore.logout().then(() => router.push({ path: '/' }))
}
</script>

<template>
  <Teleport to="body">
    <transition name="flyout-fade">
      <div v-if="open && user" v-click-outside="{ handler: closeIfOutside, ignore: [triggerEl] }"
        class="account-flyout fixed w-72 glass-strong rounded-xl shadow-2xl overflow-hidden origin-bottom-left z-1000"
        :style="style">
        <!-- Identity -->
      <button type="button" class="w-full flex items-center gap-3 p-4 hover:bg-white/5 transition-colors text-left"
        @click="go('/profile/me')">
        <img v-if="user.avatar" :src="user.avatar" :alt="user.username"
          class="w-11 h-11 rounded-full object-cover shrink-0" />
        <div v-else
          class="w-11 h-11 rounded-full bg-primary/20 text-primary flex items-center justify-center font-semibold shrink-0">
          {{ initials }}
        </div>

        <div class="min-w-0">
          <p class="text-text-primary font-semibold truncate">
            {{ user.displayName ?? user.username }}
          </p>
          <p class="text-text-muted text-xs truncate">@{{ user.username }}</p>
        </div>
      </button>

      <div class="h-px bg-white/10" />

      <!-- Actions -->
      <nav class="p-1.5">
        <button type="button"
          class="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-text-secondary hover:bg-white/10 hover:text-text-primary transition-colors"
          @click="go('/profile/me')">
          <User :size="16" />
          {{ t('nav.profile') }}
        </button>

        <button type="button"
          class="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-text-secondary hover:bg-white/10 hover:text-text-primary transition-colors"
          @click="go('/settings')">
          <Settings :size="16" />
          {{ t('nav.settings') }}
        </button>

        <button v-if="isStaff" type="button"
          class="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-text-secondary hover:bg-white/10 hover:text-text-primary transition-colors"
          @click="go('/admin/dashboard')">
          <LayoutDashboard :size="16" />
          {{ t('admin.dashboard.title') }}
        </button>

        <button v-for="group in groups" :key="group.id" type="button"
          class="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-text-secondary hover:bg-white/10 hover:text-text-primary transition-colors"
          @click="go(`/translator/dashboard/${group.slug}`)">
          <Users :size="16" />
          <span class="truncate">{{ group.name }}</span>
        </button>
      </nav>

      <div class="h-px bg-white/10" />

      <div class="p-1.5">
        <button type="button"
          class="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-red-400 hover:bg-red-500/10 transition-colors"
          @click="signOut">
          <LogOut :size="16" />
          {{ t('nav.logout') }}
        </button>
      </div>
      </div>
    </transition>
  </Teleport>
</template>

<style scoped>
.flyout-fade-enter-active {
  transition:
    opacity 0.18s ease-out,
    transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.flyout-fade-leave-active {
  transition:
    opacity 0.12s ease-in,
    transform 0.12s ease-in;
}

.flyout-fade-enter-from,
.flyout-fade-leave-to {
  opacity: 0;
  transform: translateX(-10px) scale(0.96);
}
</style>
