import { defineA1Tests } from '../mock/a1-flows.ts'
import { logIn } from '../support/session.ts'

// Track A1's flows against the production image under /wp-upload/, logged
// in, on the stack's WordPress (the `small` seed).
defineA1Tests({ prepare: logIn })
