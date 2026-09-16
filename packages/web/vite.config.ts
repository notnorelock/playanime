import { sentryVitePlugin } from "@sentry/vite-plugin";
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';
import VueRouter from 'unplugin-vue-router/vite';
import removeConsole from 'vite-plugin-remove-console';
import { fileURLToPath } from 'node:url';

export default defineConfig(({ mode }) => ({
  plugins: [
    VueRouter({
      routesFolder: 'src/views',
      dts: 'src/typed-router.d.ts',
      importMode: 'async'
    }),
    tailwindcss(),
    sentryVitePlugin({
      org: "playanime",
      project: "javascript-vue"
    }),
    vue(),
    // Remove console logs in production for security and performance
    mode === 'production' && removeConsole({
      external: ['console.log', 'console.error', 'console.warn'], // Keep errors and warnings
      includes: ['debug', 'info', 'trace'] // Remove these
    })
  ].filter(Boolean),

  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },

  build: {
    sourcemap: true,
    rollupOptions: {
      output: {
        // Use content hashes for chunk names instead of predictable names
        // This also improves security by making it harder to target specific chunks
        chunkFileNames: 'js/[hash:16].js',
        entryFileNames: 'js/[hash:16].js',
        assetFileNames: 'assets/[hash:16][extname]',

        manualChunks(id) {
          id = id.toLowerCase();

          // Split vendor code into separate chunks for better caching
          if (id.includes('node_modules')) {
            // Sentry monitoring
            if (id.includes('sentry')) {
              return 'sentry'
            }
            // All other vendors
            return 'vendor'
          }

          // Separate chunk for locale files (lazy loaded)
          if (id.includes('/locales/')) {
            // Extract locale name (e.g., 'en', 'pl')
            const match = id.match(/locales\/(\w+)\.json/)
            if (match) {
              return `locale-${match[1]}`
            }
          }

          // Seperate chunk for API
          if (id.includes('api') || id.includes('version')) return `api-playa-${id}`

          if (id.includes('watchtogether')) return `w2t-${id}`
          if (id.includes('storage')) return 'storage'
          if (id.includes('store')) return `${id}-store`
          if (id.includes('utils')) return `utils-${id}`
        }
      }
    }
  }
}))
