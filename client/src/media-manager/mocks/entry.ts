// The entry of the mock build (vite.mock.config.ts swaps it in for
// src/main.tsx): start the mock backend first, then the real app unchanged.
// Nothing in the production build imports this file.

import { startMockWorker } from './browser'

startMockWorker()
  .catch((error: unknown) => {
    console.error('The mock backend failed to start', error)
  })
  .then(() => import('../../main'))
