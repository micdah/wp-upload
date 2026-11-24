import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts', '../shared/**/*.spec.ts'],
    // Live specs need a WordPress; they run from vitest.live.config.ts.
    exclude: [...configDefaults.exclude, 'src/**/*.live.spec.ts'],
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    restoreMocks: true,
  },
})
