<script setup lang="ts">
/**
 * Footer Component
 * Glassmorphic footer with links and disclaimer
 */

import { useLocale } from '@/composables/useLocale'
import { } from 'lucide-vue-next'
import { useVersion } from '@/composables/useVersion'

const { t } = useLocale()
const { versionInfo } = useVersion()

const currentYear = new Date().getFullYear()
</script>

<template>
  <footer class="glass-medium mt-20">
    <div class="container mx-auto px-4 py-12">
      <div class="grid grid-cols-1 md:grid-cols-4 gap-8">
        <!-- Brand Section -->
        <div class="col-span-1 md:col-span-2">
          <div class="flex items-center gap-2 text-2xl font-bold mb-4">
            <div class="w-8 h-8 rounded-lg flex items-center justify-center">
              <img src="@/assets/images/playa-logo.svg" />
            </div>
            <span class="text-gradient-primary" v-text="t('common.appName')"></span>
          </div>
          <p class="text-text-secondary text-sm mb-4 leading-relaxed">
            {{ t('footer.description') }}
          </p>
          <div class="flex items-center gap-2 text-gray-300 text-sm">
            <span> © {{ currentYear }} {{ t('common.appName') }}</span>
            <span>·</span>
            <span class="flex items-center gap-1">
              {{ t('footer.madeWith') }} <Heart :size="14" class="fill-primary text-primary" /> {{ t('footer.by') }}
              <a class="hover:text-primary" target="_blank" href="https://borealise.com/?ref=playanime">
                Borealise Media Platforms
              </a>
            </span>
          </div>
        </div>

        <!-- Quick Links -->
        <div class="text-gray-300">
          <h3 class="font-semibold mb-4">{{ t('nav.browse') }}</h3>
          <ul class="space-y-2">
            <li>
              <router-link
                to="/trending"
                class="text-text-secondary hover:text-primary transition-colors text-sm"
              >
                {{ t('nav.trending') }}
              </router-link>
            </li>
            <li>
              <router-link
                to="/browse"
                class="text-text-secondary hover:text-primary transition-colors text-sm"
              >
                {{ t('home.recentlyAdded') }}
              </router-link>
            </li>
            <li>
              <router-link
                to="/browse"
                class="text-text-secondary hover:text-primary transition-colors text-sm"
              >
                {{ t('home.topRated') }}
              </router-link>
            </li>
            <li>
              <router-link
                to="/translators"
                class="text-text-secondary hover:text-primary transition-colors text-sm"
              >
                {{ t('nav.translators') }}
              </router-link>
            </li>
          </ul>
        </div>

        <!-- Information -->
        <div class="text-gray-300">
          <h3 class="text-text-primary font-semibold mb-4">{{ t('footer.about') }}</h3>
          <ul class="space-y-2">
            <li>
              <a
                href="#"
                class="text-text-secondary hover:text-primary transition-colors text-sm"
              >
                {{ t('footer.about') }}
              </a>
            </li>
            <li>
              <a
                href="#"
                class="text-text-secondary hover:text-primary transition-colors text-sm"
              >
                {{ t('footer.contact') }}
              </a>
            </li>
            <li>
              <router-link
                to="/legal/tos"
                class="text-text-secondary hover:text-primary transition-colors text-sm"
              >
                {{ t('footer.terms') }}
              </router-link>
            </li>
            <li>
              <router-link
                to="/legal/privacy"
                class="text-text-secondary hover:text-primary transition-colors text-sm"
              >
                {{ t('footer.privacy') }}
              </router-link>
            </li>
          </ul>
        </div>
      </div>

      <!-- Bottom Bar -->
      <div class="border-t border-primary mt-8 pt-6">
        <div class="flex flex-col md:flex-row items-center justify-between gap-4">
          <div class="flex flex-col gap-2">
            <p class="text-text-muted text-xs text-center md:text-left">
              {{ t('footer.disclaimer') }}: {{ t('footer.disclaimerText') }}
            </p>
            <p class="text-text-muted text-[10px] text-center md:text-left opacity-50 font-mono">
              Client v{{ versionInfo?.version || 'dev' }} · {{ versionInfo?.branch || 'unknown' }}
            </p>
          </div>
          <div class="flex items-center gap-4">
            <a
              href="https://discord.gg/2X5shMuvu6"
              target="_blank"
              rel="noopener noreferrer"
              class="text-gray-300 hover:text-primary transition-colors"
            >
              <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M20.317 4.492c-1.53-.69-3.17-1.2-4.885-1.49a.075.075 0 0 0-.079.036c-.21.369-.444.85-.608 1.23a18.566 18.566 0 0 0-5.487 0 12.36 12.36 0 0 0-.617-1.23A.077.077 0 0 0 8.562 3c-1.714.29-3.354.8-4.885 1.491a.07.07 0 0 0-.032.027C.533 9.093-.32 13.555.099 17.961a.08.08 0 0 0 .031.055 20.03 20.03 0 0 0 5.993 2.98.078.078 0 0 0 .084-.026 13.83 13.83 0 0 0 1.226-1.963.074.074 0 0 0-.041-.104 13.201 13.201 0 0 1-1.872-.878.075.075 0 0 1-.008-.125c.126-.093.252-.19.372-.287a.075.075 0 0 1 .078-.01c3.927 1.764 8.18 1.764 12.061 0a.075.075 0 0 1 .079.009c.12.098.245.195.372.288a.075.075 0 0 1-.006.125c-.598.344-1.22.635-1.873.877a.075.075 0 0 0-.041.105c.36.687.772 1.341 1.225 1.962a.077.077 0 0 0 .084.028 19.963 19.963 0 0 0 6.002-2.981.076.076 0 0 0 .032-.054c.5-5.094-.838-9.52-3.549-13.442a.06.06 0 0 0-.031-.028zM8.02 15.278c-1.182 0-2.157-1.069-2.157-2.38 0-1.312.956-2.38 2.157-2.38 1.21 0 2.176 1.077 2.157 2.38 0 1.312-.956 2.38-2.157 2.38zm7.975 0c-1.183 0-2.157-1.069-2.157-2.38 0-1.312.955-2.38 2.157-2.38 1.21 0 2.176 1.077 2.157 2.38 0 1.312-.946 2.38-2.157 2.38z" />
              </svg>
            </a>
          </div>
        </div>
      </div>
    </div>
  </footer>
</template>
