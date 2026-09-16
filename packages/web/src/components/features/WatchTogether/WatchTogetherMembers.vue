<script setup lang="ts">
/**
 * WatchTogetherMembers Component
 * Displays list of members in the watch together room
 */

import { computed } from 'vue'
import type { RoomMember } from '@/services/watchtogether'

interface Props {
  members: Record<number, RoomMember>
  hostId: number
  currentUserId?: number
}

const props = defineProps<Props>()

const membersList = computed(() => {
  return Object.values(props.members).map(member => ({
    ...member,
    isHost: member.userId === props.hostId,
    isSelf: member.userId === props.currentUserId
  })).sort((a, b) => {
    // Host first
    if (a.isHost) return -1
    if (b.isHost) return 1
    // Self second
    if (a.isSelf) return -1
    if (b.isSelf) return 1
    // Then alphabetically
    return a.username.localeCompare(b.username)
  })
})

const memberCount = computed(() => Object.keys(props.members).length)

function getAvatarUrl(avatar?: string): string {
  if (avatar) {
    return avatar
  }
  // Return default avatar
  return `https://ui-avatars.com/api/?name=${encodeURIComponent('User')}&background=6366f1&color=fff`
}

function getInitials(username: string): string {
  return username
    .split(' ')
    .map(word => word[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}
</script>

<template>
  <div class="flex flex-col h-full bg-gray-900 rounded-lg overflow-hidden">
    <!-- Header -->
    <div class="flex justify-between items-center px-4 py-3 border-b border-gray-700">
      <h3 class="text-lg font-semibold text-white">Viewers</h3>
      <span class="flex items-center justify-center min-w-[24px] h-6 px-2 bg-indigo-600 text-white rounded-full text-xs font-semibold">
        {{ memberCount }}
      </span>
    </div>

    <!-- Members List -->
    <div class="flex-1 overflow-y-auto p-2 flex flex-col gap-2 scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-transparent">
      <div
        v-for="member in membersList"
        :key="member.userId"
        :class="[
          'flex items-center gap-3 p-3 rounded-lg transition-colors duration-200 animate-fadeIn',
          member.isSelf
            ? 'bg-indigo-600/10 border border-indigo-600/30'
            : 'bg-gray-800 hover:bg-gray-750'
        ]"
      >
        <!-- Avatar -->
        <div class="flex-shrink-0 w-10 h-10 rounded-full overflow-hidden">
          <img
            v-if="member.avatar"
            :src="getAvatarUrl(member.avatar)"
            :alt="member.username"
            class="w-full h-full object-cover"
          />
          <div v-else class="w-full h-full flex items-center justify-center bg-indigo-600 text-white font-semibold text-sm">
            {{ getInitials(member.username) }}
          </div>
        </div>

        <!-- Info -->
        <div class="flex-1 min-w-0 flex flex-col gap-1">
          <div class="flex items-center gap-2 text-white font-medium text-[15px] truncate">
            {{ member.username }}
            <span v-if="member.isSelf" class="text-xs font-semibold px-2 py-0.5 rounded bg-indigo-600/20 text-indigo-400 whitespace-nowrap">
              (You)
            </span>
            <span v-if="member.isHost" class="text-xs font-semibold px-2 py-0.5 rounded bg-amber-500/20 text-amber-500 whitespace-nowrap">
              Host
            </span>
            <span v-if="member.isGuest" class="text-xs font-semibold px-2 py-0.5 rounded bg-gray-600/20 text-gray-400 whitespace-nowrap">
              Guest
            </span>
          </div>
          <div class="flex items-center gap-1.5 text-[13px]">
            <span class="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
            <span class="text-gray-400">Watching</span>
          </div>
        </div>
      </div>

      <div v-if="memberCount === 0" class="flex-1 flex items-center justify-center text-gray-500 text-sm text-center">
        <p>No members in the room</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateX(-10px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

.animate-fadeIn {
  animation: fadeIn 0.3s ease-out;
}
</style>
