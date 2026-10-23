// vite.config.js
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'
import { createLocalCmsPlugin } from './dev/localCmsServer.js'

// Tailwind v4 ships an official Vite plugin, so no tailwind.config.js or
// postcss.config.js is needed — the design tokens live in src/index.css.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const localCmsEnabled = env.VITE_CMS_PROVIDER?.trim() !== 'remote'
  const cmsApiConfigured = /^https?:\/\//i.test(env.VITE_CMS_API_URL?.trim() || '')
  const cmsApiDevGuard = {
    name: 'cms-api-dev-configuration-guard',
    apply: 'serve',
    configureServer(server) {
      if (localCmsEnabled || cmsApiConfigured) return
      server.middlewares.use((req, res, next) => {
        const pathname = (req.url || '').split('?')[0].replace(/\/+$/, '')
        if (pathname !== '/api' && !pathname.startsWith('/api/')) return next()
        res.statusCode = 503
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.setHeader('Cache-Control', 'no-store')
        res.end(JSON.stringify({ error: 'Remote CMS mode is not configured. Set VITE_CMS_API_URL to a protected CMS API endpoint or use the default local filesystem provider.' }))
      })
    },
  }

  return {
    plugins: [react(), tailwindcss(), ...(localCmsEnabled ? [createLocalCmsPlugin()] : [cmsApiDevGuard])],
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
