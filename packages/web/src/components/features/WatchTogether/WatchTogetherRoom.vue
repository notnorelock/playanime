<script setup lang="ts">
/**
 * WatchTogetherRoom Component
 * Main container for watch together functionality
 */

import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useAuthStore } from '@/store/auth'
import { useToast } from '@/composables/useToast'
import { useWatchTogether } from '@/services/watchtogether'
import type { ChatMessage, RoomMember } from '@/services/watchtogether'
import WatchTogetherChat from './WatchTogetherChat.vue'
import WatchTogetherMembers from './WatchTogetherMembers.vue'

interface Props {
  animeId: number
  episodeId: number
  roomId?: string
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'player-sync': [state: { playing: boolean; currentTime: number }]
  'room-joined': [roomId: string]
  'room-left': []
}>()

const authStore = useAuthStore()
const toast = useToast()
const wtManager = useWatchTogether()

const isConnecting = ref(false)
const isJoining = ref(false)
const guestUsername = ref('')
const showGuestPrompt = ref(false)
const activeTab = ref<'chat' | 'members'>('chat')
const latencyInterval = ref<number | null>(null)

const isConnected = computed(() => wtManager.isConnected.value)
const currentRoom = computed(() => wtManager.currentRoom.value)
const isInRoom = computed(() => currentRoom.value !== null)
const isHost = computed(() => wtManager.isHost.value)
const currentUser = computed(() => wtManager.currentUser.value)

const messages = computed<ChatMessage[]>(() => currentRoom.value?.chatHistory || [])
const members = computed<Record<number, RoomMember>>(() => currentRoom.value?.members || {})
const hostId = computed<number>(() => currentRoom.value?.host || 0)

onMounted(async () => {
  setupEventHandlers()
  await connectAndJoin()

  // Start periodic latency measurement (every 5 seconds)
  latencyInterval.value = window.setInterval(async () => {
    if (isConnected.value) {
      try {
        await wtManager.ping()
      } catch (error) {
        console.error('[WatchTogether] Ping failed:', error)
      }
    }
  }, 5000)

  // Initial ping
  if (isConnected.value) {
    wtManager.ping().catch(console.error)
  }
})

onUnmounted(async () => {
  // Stop latency measurement
  if (latencyInterval.value) {
    clearInterval(latencyInterval.value)
    latencyInterval.value = null
  }

  await leaveRoom()
  // Disconnect WebSocket
  wtManager.disconnect()
})

function setupEventHandlers() {
  // Player sync event
  wtManager.onPlayerSync = (state) => {
    console.log('[WatchTogether] Player sync received:', state)
    emit('player-sync', {
      playing: state.playing,
      currentTime: state.currentTime
    })
  }

  // Member events
  wtManager.onMemberJoined = (member) => {
    toast.info(`${member.username} joined the room`)
  }

  wtManager.onMemberLeft = (userId) => {
    const member = members.value[userId]
    if (member) {
      toast.info(`${member.username} left the room`)
    }
  }

  wtManager.onHostChanged = (newHostId) => {
    const newHost = members.value[newHostId]
    if (newHost) {
      toast.info(`${newHost.username} is now the host`)
    }
  }

  wtManager.onChatMessage = (message) => {
    // Auto-scroll handled by chat component
  }
}

async function connectAndJoin() {
  try {
    isConnecting.value = true

    // Connect to WebSocket
    if (!isConnected.value) {
      await wtManager.connect()
    }

    // Authenticate
    if (authStore.isAuthenticated && authStore.token) {
      await wtManager.authenticate(authStore.token)
    } else {
      // Guest user - show prompt for username
      showGuestPrompt.value = true
      isConnecting.value = false
      return
    }

    // Join room
    await joinRoom()
  } catch (error: any) {
    console.error('[WatchTogether] Failed to connect:', error)
    toast.error('Failed to connect to watch together')
  } finally {
    isConnecting.value = false
  }
}

async function joinAsGuest() {
  if (!guestUsername.value.trim()) {
    toast.error('Please enter a username')
    return
  }

  try {
    isJoining.value = true

    // Authenticate as guest
    await wtManager.authenticate()

    // Join room with guest username
    await joinRoom(guestUsername.value.trim())

    showGuestPrompt.value = false
  } catch (error: any) {
    console.error('[WatchTogether] Failed to join as guest:', error)
    toast.error('Failed to join as guest')
  } finally {
    isJoining.value = false
  }
}

async function joinRoom(username?: string) {
  try {
    isJoining.value = true

    const roomIdToJoin = props.roomId || `${props.animeId}-${props.episodeId}`

    const room = await wtManager.joinRoom({
      roomId: roomIdToJoin,
      animeId: props.animeId,
      episodeId: props.episodeId,
      username
    })

    console.log('[WatchTogether] Joined room:', room)
    toast.success('Joined watch together room')
    emit('room-joined', room.roomId)

    // Sync to current player state if there is one
    if (room.playerState) {
      emit('player-sync', {
        playing: room.playerState.playing,
        currentTime: room.playerState.currentTime
      })
    }
  } catch (error: any) {
    console.error('[WatchTogether] Failed to join room:', error)
    toast.error('Failed to join room')
  } finally {
    isJoining.value = false
  }
}

async function leaveRoom() {
  if (!isInRoom.value) return

  try {
    await wtManager.leaveRoom()
    toast.info('Left watch together room')
    emit('room-left')
  } catch (error: any) {
    console.error('[WatchTogether] Failed to leave room:', error)
  }
}

async function sendChatMessage(message: string) {
  try {
    await wtManager.sendChatMessage(message)
  } catch (error: any) {
    console.error('[WatchTogether] Failed to send message:', error)
    toast.error('Failed to send message')
  }
}

async function syncPlayer(playing: boolean, currentTime: number) {
  try {
    await wtManager.syncPlayer(playing, currentTime)
  } catch (error: any) {
    console.error('[WatchTogether] Failed to sync player:', error)
  }
}

// Expose methods for parent component
defineExpose({
  syncPlayer,
  leaveRoom,
  wtManager
})
</script>

<template>
  <div class="flex flex-col h-full bg-gray-950 text-white">
    <!-- Loading State -->
    <div v-if="isConnecting" class="flex-1 flex flex-col items-center justify-center gap-4 p-8 text-center">
      <div class="w-10 h-10 border-3 border-gray-700 border-t-indigo-600 rounded-full animate-spin"></div>
      <p class="text-gray-400">Connecting to watch together...</p>
    </div>

    <!-- Guest Username Prompt -->
    <div v-else-if="showGuestPrompt" class="flex-1 flex flex-col items-center justify-center gap-6 p-8 text-center">
      <h3 class="text-2xl font-semibold">Join as Guest</h3>
      <p class="text-gray-400">Enter a username to join the watch party:</p>
      <input
        v-model="guestUsername"
        type="text"
        placeholder="Your username"
        maxlength="20"
        class="w-full max-w-xs px-4 py-3 bg-gray-900 border border-gray-700 rounded-lg text-white text-base focus:outline-none focus:border-indigo-500 transition-colors"
        @keydown.enter="joinAsGuest"
      />
      <div class="flex gap-3">
        <button
          :disabled="!guestUsername.trim() || isJoining"
          class="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-medium text-sm transition-all duration-200 hover:-translate-y-0.5"
          @click="joinAsGuest"
        >
          {{ isJoining ? 'Joining...' : 'Join Room' }}
        </button>
      </div>
    </div>

    <!-- Room Interface -->
    <div v-else-if="isInRoom" class="flex flex-col h-full">
      <!-- Room Header -->
      <div class="flex justify-between items-center px-4 py-3 border-b border-gray-800">
        <div class="flex flex-col gap-0.5">
          <h3 class="text-xl font-semibold">Watch Together</h3>
          <span class="text-sm text-gray-500">Room: {{ currentRoom?.roomId }}</span>
        </div>
        <button
          class="px-5 py-2 bg-transparent hover:bg-red-500/10 hover:text-red-500 text-gray-400 border border-gray-700 hover:border-red-500 rounded-lg font-medium text-sm transition-all duration-200"
          @click="leaveRoom"
        >
          Leave Room
        </button>
      </div>

      <!-- Tabs -->
      <div class="flex gap-2 px-4 py-2 border-b border-gray-800">
        <button
          :class="[
            'flex items-center gap-2 px-4 py-2.5 rounded-lg font-medium text-sm transition-all duration-200',
            activeTab === 'chat'
              ? 'bg-indigo-600 text-white'
              : 'bg-transparent text-gray-400 hover:bg-gray-900 hover:text-white'
          ]"
          @click="activeTab = 'chat'"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
          </svg>
          Chat
          <span
            v-if="messages.length > 0"
            :class="[
              'flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-xs font-semibold',
              activeTab === 'chat'
                ? 'bg-white/20 text-white'
                : 'bg-gray-800 text-gray-500'
            ]"
          >
            {{ messages.length }}
          </span>
        </button>
        <button
          :class="[
            'flex items-center gap-2 px-4 py-2.5 rounded-lg font-medium text-sm transition-all duration-200',
            activeTab === 'members'
              ? 'bg-indigo-600 text-white'
              : 'bg-transparent text-gray-400 hover:bg-gray-900 hover:text-white'
          ]"
          @click="activeTab = 'members'"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
            <circle cx="9" cy="7" r="4"></circle>
            <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
            <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
          </svg>
          Members
          <span
            :class="[
              'flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-xs font-semibold',
              activeTab === 'members'
                ? 'bg-white/20 text-white'
                : 'bg-gray-800 text-gray-500'
            ]"
          >
            {{ Object.keys(members).length }}
          </span>
        </button>
      </div>

      <!-- Tab Content -->
      <div class="flex-1 overflow-hidden p-4">
        <WatchTogetherChat
          v-show="activeTab === 'chat'"
          :messages="messages"
          :disabled="!isInRoom"
          @send-message="sendChatMessage"
        />
        <WatchTogetherMembers
          v-show="activeTab === 'members'"
          :members="members"
          :host-id="hostId"
          :current-user-id="currentUser?.id"
        />
      </div>
    </div>

    <!-- Not in room state -->
    <div v-else class="flex-1 flex flex-col items-center justify-center gap-4 p-8 text-center">
      <p class="text-gray-400">Not connected to watch together room</p>
      <button
        class="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg font-medium text-sm transition-all duration-200 hover:-translate-y-0.5"
        @click="connectAndJoin"
      >
        {{ isJoining ? 'Joining...' : 'Join Room' }}
      </button>
    </div>
  </div>
</template>
