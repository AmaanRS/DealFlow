import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '')

  return {
    plugins: [react()],
    optimizeDeps: {
      include: ['recharts', 'jspdf'],
    },
    server: {
      host: true,
      port: 5173,
      strictPort: true,
      /**
       * Behind APISIX the browser only ever sees the gateway on 9080, while this
       * dev server listens on 5173. Vite would tell the HMR client to open its
       * socket on 5173, a port the browser cannot reach, so the client port is
       * overridden to the gateway. Left unset — running `npm run dev` directly —
       * Vite's own defaults apply.
       */
      ...(env.VITE_HMR_CLIENT_PORT
        ? {
            hmr: {
              protocol: env.VITE_HMR_PROTOCOL || 'ws',
              host: env.VITE_HMR_HOST || 'localhost',
              clientPort: Number(env.VITE_HMR_CLIENT_PORT),
            },
          }
        : {}),
      /**
       * Bind-mounted source on macOS and Windows does not deliver inotify
       * events into the container, so file changes are polled.
       */
      watch: {
        usePolling: true,
        interval: 300,
      },
      proxy: {
        '/v1/api': {
          target: env.VITE_API_PROXY_TARGET || 'http://localhost:9080',
          changeOrigin: true,
        },
        '/api': {
          target: env.VITE_API_PROXY_TARGET || 'http://localhost:9080',
          changeOrigin: true,
        },
      },
    },
  }
})
