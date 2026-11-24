import { logIn } from '../support/session.ts'
import { defineSubPathSmokeTests } from '../support/smoke.ts'

// Track D's smoke test of the production image under /wp-upload/, logged in,
// against the test stack's WordPress.
defineSubPathSmokeTests({ prepare: logIn })
