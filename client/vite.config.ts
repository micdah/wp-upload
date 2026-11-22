import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// `dev/run up dev` writes dev/.env.wp with this worktree's ports. Vite reads
// `.env.[mode]` files, so loading mode "wp" from dev/ picks it up; without the
// file the defaults apply.
const devStackEnv = loadEnv(
  'wp',
  fileURLToPath(new URL('../dev', import.meta.url)),
  'WPU_',
)
const apiTarget = devStackEnv.WPU_API_TARGET || 'http://localhost:3001'
const vitePort = Number(devStackEnv.WPU_VITE_PORT) || undefined

export default defineConfig({
  // Relative asset URLs so the built app works at `/` and under any sub-path
  // behind a prefix-stripping reverse proxy.
  base: './',
  plugins: [react()],
  server: {
    host: true,
    port: vitePort,
    // A worktree's port is fixed in dev/.env.wp; never drift to another one.
    strictPort: vitePort !== undefined,
    proxy: {
      '/api': apiTarget,
      // Login/logout live at the app root, not under /api - see
      // server/src/lib/session.ts for why.
      '/session': apiTarget,
    },
  },
})
