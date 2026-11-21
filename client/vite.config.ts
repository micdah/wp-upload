import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  // Relative asset URLs so the built app works at `/` and under any sub-path
  // behind a prefix-stripping reverse proxy.
  base: './',
  plugins: [react()],
  server: {
    host: true,
    proxy: {
      '/api': 'http://localhost:3001',
      // Login/logout live at the app root, not under /api - see
      // server/src/lib/session.ts for why.
      '/session': 'http://localhost:3001',
    },
  },
})
