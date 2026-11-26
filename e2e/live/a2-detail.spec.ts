import { defineDetailTests } from '../support/a2-detail.ts'
import { logIn } from '../support/session.ts'

// Track A2 (detail mode) against the production image under /wp-upload/,
// logged in, on the stack's WordPress (the `small` seed: images plus the
// dev fixtures' mp4, mp3, pdf and svg).
defineDetailTests({
  prepare: logIn,
  archiveId: null,
  videoPosters: false,
})
