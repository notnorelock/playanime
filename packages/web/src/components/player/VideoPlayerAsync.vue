<script setup lang="ts">
/**
 * Async player wrapper.
 *
 * The player pulls in hls.js, which is large and only needed once a viewer
 * actually reaches a watch page. Loading it lazily keeps it out of the initial
 * bundle for every other route, and the skeleton stands in meanwhile.
 */

import { defineAsyncComponent, ref } from 'vue'
import type { PlaybackDescriptor } from '@playanime/contracts'
import VideoPlayerSkeleton from './VideoPlayerSkeleton.vue'

interface Props {
  descriptor: PlaybackDescriptor | null
  poster?: string | null
  autoplay?: boolean
  resumeAt?: number
  introStartSeconds?: number | null
  introEndSeconds?: number | null
  refreshPlayback: () => Promise<PlaybackDescriptor>
}

defineProps<Props>()

const emit = defineEmits<{
  timeUpdate: [time: number]
  paused: [time: number]
  seeked: [time: number]
  ended: [time: number]
  ready: []
}>()

interface VideoPlayerExposed {
  play: () => Promise<void>
  pause: () => void
  togglePlay: () => void
  seekPercent: (percent: number) => void
}

const VideoPlayer = defineAsyncComponent({
  loader: () => import('./VideoPlayer.vue'),
  loadingComponent: VideoPlayerSkeleton,
  delay: 200,
  timeout: 15000
})

const videoPlayerRef = ref<VideoPlayerExposed | null>(null)

defineExpose({
  play: () => videoPlayerRef.value?.play(),
  pause: () => videoPlayerRef.value?.pause(),
  togglePlay: () => videoPlayerRef.value?.togglePlay(),
  seekPercent: (percent: number) => videoPlayerRef.value?.seekPercent(percent)
})
</script>

<template>
  <VideoPlayer
    ref="videoPlayerRef"
    v-bind="$props"
    @time-update="(time: number) => emit('timeUpdate', time)"
    @paused="(time: number) => emit('paused', time)"
    @seeked="(time: number) => emit('seeked', time)"
    @ended="(time: number) => emit('ended', time)"
    @ready="emit('ready')"
  />
</template>
