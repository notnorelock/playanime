<script setup lang="ts">
/**
 * WatchTogetherChat Component
 * Chat interface for watch together rooms
 */

import { ref, computed, watch, nextTick } from 'vue'
import { useAuthStore } from '@/store/auth'
import type { ChatMessage } from '@/services/watchtogether'

interface Props {
  messages: ChatMessage[]
  disabled?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  disabled: false
})

const emit = defineEmits<{
  'send-message': [message: string]
}>()

const authStore = useAuthStore()
const messageInput = ref('')
const chatContainer = ref<HTMLElement | null>(null)

const currentUserId = computed(() => authStore.user?.id)

const formattedMessages = computed(() => {
  return props.messages.map(msg => ({
    ...msg,
    isOwn: msg.userId === currentUserId.value,
    formattedTime: formatTime(msg.timestamp)
  }))
})

const canSendMessage = computed(() => {
  return !props.disabled && messageInput.value.trim().length > 0
})

function formatTime(timestamp: string): string {
  const date = new Date(timestamp)
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit'
  })
}

function sendMessage() {
  if (!canSendMessage.value) return

  const message = messageInput.value.trim()
  emit('send-message', message)
  messageInput.value = ''
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    sendMessage()
  }
}

// Auto-scroll to bottom when new messages arrive
watch(() => props.messages.length, async () => {
  await nextTick()
  if (chatContainer.value) {
    chatContainer.value.scrollTop = chatContainer.value.scrollHeight
  }
})
</script>

<template>
  <div class="flex flex-col h-full bg-gray-900 rounded-lg overflow-hidden">
    <!-- Chat Header -->
    <div class="flex justify-between items-center px-4 py-3 border-b border-gray-700">
      <h3 class="text-lg font-semibold text-white">Chat</h3>
      <span class="text-sm text-gray-400">{{ messages.length }} messages</span>
    </div>

    <!-- Messages Container -->
    <div
      ref="chatContainer"
      class="flex-1 overflow-y-auto p-4 flex flex-col gap-3 scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-transparent"
    >
      <div
        v-for="msg in formattedMessages"
        :key="msg.id"
        :class="[
          'flex flex-col gap-1 p-3 rounded-lg max-w-[80%] animate-slideIn',
          msg.isOwn ? 'self-end bg-indigo-600' : 'bg-gray-800'
        ]"
      >
        <div class="flex justify-between items-center gap-2">
          <span :class="['text-sm font-semibold', msg.isOwn ? 'text-white/95' : 'text-white']">
            {{ msg.username }}
          </span>
          <span :class="['text-xs', msg.isOwn ? 'text-white/70' : 'text-gray-500']">
            {{ msg.formattedTime }}
          </span>
        </div>
        <div :class="['text-[15px] leading-relaxed break-words', msg.isOwn ? 'text-white/95' : 'text-gray-300']">
          {{ msg.message }}
        </div>
      </div>

      <div v-if="messages.length === 0" class="flex-1 flex items-center justify-center text-gray-500 text-sm text-center">
        <p>No messages yet. Start the conversation!</p>
      </div>
    </div>

    <!-- Message Input -->
    <div class="flex gap-2 p-4 border-t border-gray-700 bg-gray-900">
      <textarea
        v-model="messageInput"
        :disabled="disabled"
        :placeholder="disabled ? 'Join a room to chat' : 'Type a message...'"
        class="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-white text-sm resize-none focus:outline-none focus:border-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed placeholder:text-gray-600"
        rows="2"
        maxlength="500"
        @keydown="handleKeydown"
      />
      <button
        :disabled="!canSendMessage"
        class="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-md transition-all duration-200 active:scale-100 flex items-center justify-center"
        @click="sendMessage"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="22" y1="2" x2="11" y2="13"></line>
          <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
@keyframes slideIn {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.animate-slideIn {
  animation: slideIn 0.2s ease-out;
}
</style>
