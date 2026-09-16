/**
 * Directives Module
 * Registers global Vue directives
 * @module modules/directives
 */

import type { App } from 'vue'
import { clickOutside } from '@/directives'

/**
 * Registers all global directives
 */
export function setupDirectives(app: App) {
  // Register click-outside directive
  app.directive('click-outside', clickOutside)

  console.log('[directives] Global directives registered')
}
