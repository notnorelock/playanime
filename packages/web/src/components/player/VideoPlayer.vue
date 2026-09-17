<script setup lang="ts">
/**
 * Video player.
 *
 * Driven entirely by a `PlaybackDescriptor` from the API. The player does not
 * know what a provider is: it receives `hls`, `native`, `iframe`, `external` or
 * `unavailable` and renders the corresponding surface. No URL is constructed
 * here, and no provider is special-cased — that work belongs to
 * `@playanime/external-media` on the server, where it can be done safely.
 *
 * Quality, expiry refresh and iframe fallback come from the shared adapters in
 * `@playanime/player` via `usePlaybackEngine`, so the API and the web app agree
 * on playback behaviour by construction rather than by convention.
 */

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  Settings,
  SkipForward,
  SkipBack,
  Loader2,
  ExternalLink,
  AlertTriangle,
  Check
} from 'lucide-vue-next'
import type { PlaybackDescriptor } from '@playanime/contracts'
import type { QualitySelection } from '@playanime/player'
import { useLocale } from '@/composables/useLocale'

// Composables
import { useVideoControls } from './composables/useVideoControls'
import { usePlaybackEngine } from './composables/usePlaybackEngine'
import { usePlayerUI } from './composables/usePlayerUI'
import { useVideoEvents } from './composables/useVideoEvents'
import { useProgressBar } from './composables/useProgressBar'
import { useKeyboardShortcuts } from './composables/useKeyboardShortcuts'
import { useSkipIntro } from './composables/useSkipIntro'

import { formatTime } from './utils/formatTime'

interface Props {
  descriptor: PlaybackDescriptor | null
  poster?: string | null
  autoplay?: boolean
  /** Seconds to resume from, from the viewer's stored progress. */
  resumeAt?: number
  introStartSeconds?: number | null
  introEndSeconds?: number | null
  /** Re-resolves the current source when a temporary URL expires. */
  refreshPlayback: () => Promise<PlaybackDescriptor>
}

const props = withDefaults(defineProps<Props>(), {
  poster: null,
  autoplay: false,
  resumeAt: 0,
  introStartSeconds: null,
  introEndSeconds: null
})

const emit = defineEmits<{
  timeUpdate: [time: number]
  paused: [time: number]
  seeked: [time: number]
  ended: [time: number]
  ready: []
  /** The viewer confirmed they finished an embedded (iframe) source — the only completion signal available for one, since it reports no playback events to this page. */
  markedWatched: []
}>()

const { t } = useLocale()

const videoContainer = ref<HTMLDivElement>()
const videoElement = ref<HTMLVideoElement>()
const progressBar = ref<HTMLDivElement>()

const {
  isPlaying,
  isMuted,
  currentTime,
  duration,
  volume,
  playbackRate,
  playbackRates,
  togglePlay,
  play,
  pause,
  toggleMute,
  setVolume,
  seekPercent,
  skip,
  setPlaybackRate
} = useVideoControls(videoElement)

const engine = usePlaybackEngine(videoElement, {
  refreshPlayback: () => props.refreshPlayback(),
  onError: (error) => {
    console.error('Playback error:', error)
  }
})

const {
  isFullscreen,
  showControls,
  showSettings,
  showControlsTemporarily,
  onMouseMove,
  toggleFullscreen,
  onFullscreenChange,
  cleanup: cleanupUI
} = usePlayerUI(videoContainer, isPlaying)

const { bufferedPercent, setupVideoListeners } = useVideoEvents(
  videoElement,
  (videoDuration) => {
    duration.value = videoDuration
  },
  (time) => {
    currentTime.value = time
    emit('timeUpdate', time)
  },
  () => {
    isPlaying.value = false
    emit('ended', currentTime.value)
  },
  () => {
    /* play */
  }
)

const { isHoveringProgress, hoverTime, onProgressClick, onProgressHover } = useProgressBar(
  progressBar,
  duration,
  seekPercent
)

const { onKeyPress } = useKeyboardShortcuts(togglePlay, toggleFullscreen, toggleMute, skip, setVolume, volume)

const { showSkipIntro, remainingIntroTime, introEnd } = useSkipIntro(currentTime, {
  introStart: props.introStartSeconds ?? 0,
  introEnd: props.introEndSeconds ?? 0
})

const skipIntro = () => {
  if (introEnd !== undefined && duration.value > 0) {
    seekPercent((introEnd / duration.value) * 100)
  }
}

/* -------------------------------------------------------------------------- */
/* Descriptor rendering                                                        */
/* -------------------------------------------------------------------------- */

const descriptorType = computed(() => props.descriptor?.type ?? null)

/** True when the surface is our own `<video>` rather than a provider's frame. */
const isNativeSurface = computed(
  () => (descriptorType.value === 'hls' || descriptorType.value === 'native') && !engine.isEmbedded.value
)

const iframeSrc = computed(() => {
  if (engine.fallbackIframeSrc.value !== null) return engine.fallbackIframeSrc.value
  return props.descriptor?.type === 'iframe' ? props.descriptor.url : null
})

/**
 * Whether the viewer has already clicked "mark as watched" for the
 * CURRENT iframe source. Reset whenever the source itself changes, so
 * switching episodes (or a fallback swapping in a different provider)
 * shows the button again rather than carrying a stale "watched" state
 * over from a previous source.
 */
const markedWatched = ref(false)
watch(iframeSrc, () => {
  markedWatched.value = false
})

function handleMarkWatched(): void {
  markedWatched.value = true
  emit('markedWatched')
}

const iframeAllow = computed(() =>
  props.descriptor?.type === 'iframe' ? props.descriptor.allow : 'autoplay; fullscreen; encrypted-media'
)

/**
 * Sandbox for a third-party frame.
 *
 * `allow-same-origin` is granted only when the provider's descriptor says its
 * embed requires it — the server decides that per provider, because granting it
 * unconditionally would let every embed reach this origin's storage.
 */
const iframeSandbox = computed(() => {
  const base = 'allow-scripts allow-presentation allow-popups allow-popups-to-escape-sandbox'
  const requiresSameOrigin =
    props.descriptor?.type === 'iframe' ? props.descriptor.requiresSameOrigin : false
  return requiresSameOrigin ? `${base} allow-same-origin` : base
})

const externalUrl = computed(() => (props.descriptor?.type === 'external' ? props.descriptor.url : null))
const externalHost = computed(() =>
  props.descriptor?.type === 'external' ? props.descriptor.displayHost : null
)

const unavailableReason = computed(() =>
  props.descriptor?.type === 'unavailable' ? props.descriptor.reason : null
)
const unavailableFallbackUrl = computed(() =>
  props.descriptor?.type === 'unavailable' ? props.descriptor.fallbackUrl ?? null : null
)

const isLoading = computed(() => engine.isLoading.value)

const currentQualityLabel = computed(() => {
  const selection = engine.selectedQuality.value
  if (selection === 'auto') return t('player.auto')
  return `${String(selection)}p`
})

const applyQuality = (selection: QualitySelection) => {
  void engine.setQuality(selection)
}

/* -------------------------------------------------------------------------- */
/* Lifecycle                                                                   */
/* -------------------------------------------------------------------------- */

/** Loads a descriptor into the engine and resumes where the viewer stopped. */
async function loadDescriptor(next: PlaybackDescriptor | null): Promise<void> {
  if (next === null) return

  await engine.load(next, props.resumeAt > 0 ? props.resumeAt : undefined)

  emit('ready')

  if (props.autoplay && isNativeSurface.value) {
    // Autoplay is best-effort: browsers reject it without a user gesture unless
    // the media is muted, and a rejected promise here is not an error.
    await play().catch(() => undefined)
  }
}

// A new descriptor means a new source, a new quality, or a new episode. The
// engine disposes of the previous adapter before attaching the next, so no
// listener or media pipeline outlives the descriptor that created it.
watch(
  () => props.descriptor,
  (next) => {
    void loadDescriptor(next)
  }
)

// Progress must be recorded at these moments, not only on the interval tick.
function handlePause(): void {
  isPlaying.value = false
  emit('paused', currentTime.value)
}

function handleSeeked(): void {
  emit('seeked', currentTime.value)
}

onMounted(() => {
  setupVideoListeners(isPlaying, volume, isMuted, duration, ref(false))

  videoElement.value?.addEventListener('pause', handlePause)
  videoElement.value?.addEventListener('seeked', handleSeeked)
  document.addEventListener('fullscreenchange', onFullscreenChange)
  document.addEventListener('keydown', onKeyPress)

  void loadDescriptor(props.descriptor)
})

onBeforeUnmount(() => {
  // Every listener and the media engine are released here. Leaving any of them
  // attached is what turns episode-hopping into a memory leak.
  videoElement.value?.removeEventListener('pause', handlePause)
  videoElement.value?.removeEventListener('seeked', handleSeeked)
  document.removeEventListener('fullscreenchange', onFullscreenChange)
  document.removeEventListener('keydown', onKeyPress)

  engine.dispose()
  cleanupUI()
})

watch(isPlaying, (playing) => {
  if (playing) {
    showControlsTemporarily()
  } else {
    showControls.value = true
  }
})

const currentTimeFormatted = computed(() => formatTime(currentTime.value))
const durationFormatted = computed(() => formatTime(duration.value))
const progressPercent = computed(() =>
  duration.value > 0 ? (currentTime.value / duration.value) * 100 : 0
)

defineExpose({
  play,
  pause,
  togglePlay,
  seekPercent,
  currentTime,
  duration,
  isPlaying
})
</script>

<template>
  <!-- Off-site provider: PlayAnime never frames content a provider has not offered. -->
  <div
    v-if="descriptorType === 'external'"
    class="relative w-full aspect-video bg-dark-900 flex flex-col items-center justify-center gap-4 rounded-lg"
  >
    <ExternalLink :size="40" class="text-primary" />
    <p class="text-text-secondary text-center max-w-md px-6">{{ t('player.externalNotice') }}</p>
    <a
      v-if="externalUrl"
      :href="externalUrl"
      target="_blank"
      rel="noopener noreferrer"
      class="px-5 py-2.5 rounded-lg bg-primary text-white font-semibold hover:bg-primary-hover transition-colors"
    >
      {{ t('player.openExternally') }}<span v-if="externalHost"> · {{ externalHost }}</span>
    </a>
  </div>

  <!-- Nothing playable. The server's reason is shown rather than a generic error. -->
  <div
    v-else-if="descriptorType === 'unavailable'"
    class="relative w-full aspect-video bg-dark-900 flex flex-col items-center justify-center gap-4 rounded-lg"
  >
    <AlertTriangle :size="40" class="text-yellow-400" />
    <p class="text-text-secondary text-center max-w-md px-6">
      {{ t('player.sourceUnavailable') }}
    </p>
    <p v-if="unavailableReason" class="text-text-muted text-xs">{{ unavailableReason }}</p>
    <a
      v-if="unavailableFallbackUrl"
      :href="unavailableFallbackUrl"
      target="_blank"
      rel="noopener noreferrer"
      class="px-5 py-2.5 rounded-lg glass-medium font-semibold hover:glass-strong transition-colors"
    >
      {{ t('player.openExternally') }}
    </a>
  </div>

  <!-- Sandboxed provider embed. -->
  <div
    v-else-if="iframeSrc"
    class="relative w-full aspect-video bg-black overflow-hidden rounded-lg"
  >
    <iframe
      :src="iframeSrc"
      :allow="iframeAllow"
      :sandbox="iframeSandbox"
      class="w-full h-full border-0"
      allowfullscreen
      referrerpolicy="strict-origin-when-cross-origin"
    />

    <!--
      An embedded provider's own player exposes no timeupdate/ended events
      to this page, so there is no way to track real position here — this
      is a deliberate manual signal instead of a guessed one.
    -->
    <button
      v-if="!markedWatched"
      type="button"
      class="absolute bottom-3 right-3 flex items-center gap-2 px-3 py-2 rounded-lg glass-strong text-sm font-medium text-text-primary hover:bg-primary/20 transition-colors"
      @click="handleMarkWatched"
    >
      <Check :size="16" />
      {{ t('player.markAsWatched') }}
    </button>
    <div
      v-else
      class="absolute bottom-3 right-3 flex items-center gap-2 px-3 py-2 rounded-lg glass-strong text-sm font-medium text-primary"
    >
      <Check :size="16" />
      {{ t('player.markedAsWatched') }}
    </div>
  </div>

  <!-- In-page playback. -->
  <div
    v-else
    ref="videoContainer"
    class="playanime-player relative w-full bg-black aspect-video overflow-hidden group"
    @mousemove="onMouseMove"
    @mouseleave="isHoveringProgress = false"
  >
    <video
      ref="videoElement"
      class="w-full h-full"
      :poster="poster ?? undefined"
      @click="togglePlay"
      playsinline
    />

    <!-- Loading Spinner -->
    <transition name="fade">
      <div v-if="isLoading" class="absolute inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm">
        <Loader2 :size="48" class="text-primary animate-spin" />
      </div>
    </transition>

    <!-- Controls Overlay -->
    <transition name="fade">
      <div
        v-show="showControls || !isPlaying"
        class="absolute inset-0 bg-linear-to-t from-black/80 via-transparent to-black/40 pointer-events-none"
      />
    </transition>

    <!-- Center Play Button -->
    <transition name="scale-fade">
      <button
        v-if="!isPlaying && !isLoading"
        @click="play"
        class="absolute inset-0 m-auto w-20 h-20 flex items-center justify-center bg-primary/90 rounded-full hover:bg-primary transition-all duration-300 shadow-2xl pointer-events-auto"
      >
        <Play :size="32" class="fill-white text-white ml-1" />
      </button>
    </transition>

    <!-- Skip Intro Button -->
    <transition name="slide-up">
      <button
        v-if="showSkipIntro && isPlaying"
        @click="skipIntro"
        class="absolute bottom-24 right-6 glass-strong px-4 py-2 rounded-lg hover:bg-primary transition-all duration-300 pointer-events-auto"
      >
        <span class="font-semibold">{{ t('player.skipIntro') }}</span>
        <span class="text-xs opacity-75 ml-2">{{ Math.ceil(remainingIntroTime) }}s</span>
      </button>
    </transition>

    <!-- Bottom Controls -->
    <transition name="slide-up">
      <div v-show="showControls || !isPlaying" class="absolute bottom-0 left-0 right-0 p-4 pointer-events-auto">
        <!-- Progress Bar -->
        <div
          ref="progressBar"
          class="relative h-1.5 mb-3 bg-white/20 rounded-full cursor-pointer hover:h-2 transition-all duration-200"
          @click="onProgressClick"
          @mouseenter="isHoveringProgress = true"
          @mousemove="onProgressHover"
          @mouseleave="isHoveringProgress = false"
        >
          <div
            class="absolute inset-y-0 left-0 bg-white/30 rounded-full transition-all duration-300"
            :style="{ width: `${bufferedPercent}%` }"
          />

          <div
            class="absolute inset-y-0 left-0 bg-primary rounded-full transition-all duration-100"
            :style="{ width: `${progressPercent}%` }"
          />

          <div
            v-if="isHoveringProgress && duration > 0"
            class="absolute top-1/2 -translate-y-1/2 w-0.5 h-6 bg-white/80 rounded-full transition-all duration-100"
            :style="{ left: `${(hoverTime / duration) * 100}%` }"
          />

          <div
            class="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow-lg transform transition-all duration-100"
            :class="{ 'scale-150': isHoveringProgress }"
            :style="{ left: `${progressPercent}%` }"
          />
        </div>

        <!-- Control Buttons -->
        <div class="flex items-center justify-between">
          <!-- Left Controls -->
          <div class="flex items-center gap-2">
            <button @click="togglePlay" class="p-2 rounded-lg hover:bg-white/10 transition-colors">
              <Play v-if="!isPlaying" :size="24" class="fill-white text-white" />
              <Pause v-else :size="24" class="fill-white text-white" />
            </button>

            <button @click="skip(-10)" class="p-2 rounded-lg hover:bg-white/10 transition-colors">
              <SkipBack :size="20" />
            </button>

            <button @click="skip(10)" class="p-2 rounded-lg hover:bg-white/10 transition-colors">
              <SkipForward :size="20" />
            </button>

            <!-- Volume -->
            <div class="flex items-center gap-2 group/volume">
              <button @click="toggleMute" class="p-2 rounded-lg hover:bg-white/10 transition-colors">
                <Volume2 v-if="!isMuted && volume > 0" :size="20" />
                <VolumeX v-else :size="20" />
              </button>

              <div
                class="flex items-center w-0 opacity-0 group-hover/volume:w-24 group-hover/volume:opacity-100 transition-all duration-300"
              >
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  :value="volume"
                  @input="(e) => setVolume(parseFloat((e.target as HTMLInputElement).value))"
                  class="w-full h-1 bg-white/20 rounded-full appearance-none cursor-pointer slider"
                />
              </div>
            </div>

            <span class="text-sm font-medium ml-2">
              {{ currentTimeFormatted }} / {{ durationFormatted }}
            </span>
          </div>

          <!-- Right Controls -->
          <div class="flex items-center gap-2">
            <!-- Quality indicator, shown only once pinned off Auto. -->
            <div
              v-if="engine.selectedQuality.value !== 'auto'"
              class="flex items-center gap-1.5 px-2 py-1 rounded bg-black/40 text-xs"
            >
              <span class="font-medium">{{ currentQualityLabel }}</span>
            </div>

            <!-- Settings -->
            <div class="relative">
              <button
                @click="showSettings = !showSettings"
                class="p-2 rounded-lg hover:bg-white/10 transition-colors"
                :class="{ 'bg-white/10': showSettings }"
              >
                <Settings :size="20" />
              </button>

              <transition name="scale-fade">
                <div
                  v-if="showSettings"
                  class="absolute bottom-full right-0 mb-2 w-48 glass-strong rounded-lg p-1.5 shadow-2xl max-h-96 overflow-y-auto"
                >
                  <!--
                    Quality options come from the descriptor: the renditions the
                    provider actually advertised. Nothing is fabricated, so a
                    source with one rendition shows one entry.
                  -->
                  <div v-if="engine.qualities.value.length > 1" class="mb-3">
                    <div class="text-xs font-semibold mb-1 px-2 text-text-muted">
                      {{ t('player.quality') }}
                    </div>
                    <button
                      v-for="option in engine.qualities.value"
                      :key="String(option.value)"
                      @click="applyQuality(option.value)"
                      class="w-full text-left px-2 py-1 rounded text-sm hover:bg-white/10 transition-colors"
                      :class="{ 'bg-primary text-white': engine.selectedQuality.value === option.value }"
                    >
                      {{ option.value === 'auto' ? t('player.auto') : option.label }}
                    </button>
                  </div>

                  <!-- Playback Speed -->
                  <div>
                    <div class="text-xs font-semibold mb-1 px-2 text-text-muted">
                      {{ t('player.playbackSpeed') }}
                    </div>
                    <button
                      v-for="rate in playbackRates"
                      :key="rate"
                      @click="setPlaybackRate(rate)"
                      class="w-full text-left px-2 py-1 rounded text-sm hover:bg-white/10 transition-colors"
                      :class="{ 'bg-primary text-white': playbackRate === rate }"
                    >
                      {{ rate }}x
                    </button>
                  </div>
                </div>
              </transition>
            </div>

            <!-- Fullscreen -->
            <button @click="toggleFullscreen" class="p-2 rounded-lg hover:bg-white/10 transition-colors">
              <Maximize v-if="!isFullscreen" :size="20" />
              <Minimize v-else :size="20" />
            </button>
          </div>
        </div>
      </div>
    </transition>
  </div>
</template>

<style scoped>
/* Transitions */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.scale-fade-enter-active,
.scale-fade-leave-active {
  transition: all 0.3s ease;
}

.scale-fade-enter-from,
.scale-fade-leave-to {
  opacity: 0;
  transform: scale(0.9);
}

.slide-up-enter-active,
.slide-up-leave-active {
  transition: all 0.3s ease;
}

.slide-up-enter-from,
.slide-up-leave-to {
  opacity: 0;
  transform: translateY(20px);
}

/* Volume Slider */
.slider::-webkit-slider-thumb {
  appearance: none;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: white;
  cursor: pointer;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
}

.slider::-moz-range-thumb {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: white;
  cursor: pointer;
  border: none;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
}

.slider::-webkit-slider-runnable-track {
  background: linear-gradient(
    to right,
    var(--color-primary) var(--value, 0%),
    rgba(255, 255, 255, 0.2) var(--value, 0%)
  );
  border-radius: 999px;
}
</style>
