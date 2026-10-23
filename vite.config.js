// vite.config.js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'
import { createLocalCmsPlugin } from './dev/localCmsServer.js'

// Tailwind v4 ships an official Vite plugin, so no tailwind.config.js or
// postcss.config.js is needed — the design tokens live in src/index.css.
export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), createLocalCmsPlugin()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      host: true,
      port: 5173,
      strictPort: true,
      allowedHosts: ['dev.localhost', 'admin.localhost'],
    },
    build: {
      // Three.js is large by nature. The 3D scenes are lazy-loaded, so the
      // first paint stays light; we only raise the warning threshold here.
      chunkSizeWarningLimit: 1200,
    },
  }
})
