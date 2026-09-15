import { defineConfig, loadEnv } from 'vite';
import solid from 'vite-plugin-solid';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  // Only VITE_-prefixed variables reach the client bundle. Loaded from the
  // monorepo root so there is one .env rather than one per package.
  const env = loadEnv(mode, resolve(root, '../..'), 'VITE_');
  // 127.0.0.1 rather than localhost: on Windows, localhost resolves to both
  // ::1 and 127.0.0.1, and Node tries IPv6 first. The API binds 0.0.0.0, which
  // is IPv4-only, so the proxy fails with EACCES before falling back — a
  // failure curl hides because it retries the other family automatically.
  const apiUrl = env['VITE_API_URL'] ?? 'http://127.0.0.1:4000';

  return {
    plugins: [solid(), tailwindcss()],

    resolve: {
      alias: {
        '~': resolve(root, 'src'),
      },
    },

    /**
     * Dependency pre-bundling.
     *
     * `vite-plugin-solid` sets the `solid` export condition, which points these
     * packages at unbundled JSX source. The dev server then serves every
     * internal module as its own request — Kobalte is several hundred, lucide
     * roughly 1,600 — which exhausts the browser's connection pool and produces
     * ERR_CONNECTION_REFUSED on first load.
     *
     * Forcing them through esbuild collapses each into a single module.
     * `needsInterop` is not required: they are already ESM.
     */
    optimizeDeps: {
      include: ['@kobalte/core', 'lucide-solid', 'solid-js', '@solidjs/router'],
      // esbuild must understand the JSX these packages ship in source form.
      esbuildOptions: {
        jsx: 'preserve',
      },
    },

    css: {
      preprocessorOptions: {
        scss: {
          // sass-embedded's modern compiler; the legacy JS API is deprecated
          // and roughly an order of magnitude slower on a tree this size.
          api: 'modern-compiler',
          // Silences the deprecation notices emitted from inside Tailwind's own
          // stylesheets, which are not actionable here.
          silenceDeprecations: ['import'],
        },
      },
    },

    server: {
      port: 3000,
      strictPort: true,
      /**
       * Proxy the API through the dev server.
       *
       * This makes the browser treat the API as same-origin, so the session
       * cookie is first-party in development exactly as it is in production
       * behind nginx. Calling the API cross-origin in dev and same-origin in
       * production is how SameSite bugs reach production undetected.
       */
      proxy: {
        '/api': {
          target: apiUrl,
          changeOrigin: false,
          secure: false,
        },
      },
    },

    build: {
      target: 'es2022',
      sourcemap: true,
      rollupOptions: {
        output: {
          /**
           * Split vendor code so an application change does not invalidate the
           * framework chunk in returning visitors' caches.
           *
           * A predicate rather than a name map: Kobalte ships only subpath
           * exports (`@kobalte/core/button`), so naming the package as a chunk
           * entry fails to resolve. Matching on the module path groups every
           * subpath into one chunk.
           */
          manualChunks(id: string): string | undefined {
            if (!id.includes('node_modules')) return undefined;

            if (id.includes('solid-js') || id.includes('@solidjs/router')) return 'solid';
            if (id.includes('@kobalte')) return 'kobalte';
            if (id.includes('lucide-solid')) return 'icons';

            return undefined;
          },
        },
      },
    },
  };
});
