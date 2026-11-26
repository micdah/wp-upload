import { logIn } from '../support/session.ts'
import { defineSliceTests } from '../support/slice.ts'

// The M2 slice against the production image under /wp-upload/, logged in,
// on the stack's WordPress (the `small` seed): saved text survives a reload.
defineSliceTests({
  prepare: logIn,
  persists: true,
  slowWrites: { route: true },
})
