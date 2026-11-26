import { defineDetailTests } from '../support/a2-detail.ts'

// Track A2 (detail mode) against the mock build under /wp-upload-mock/.
defineDetailTests({
  // The mock's own dev scenario switcher isn't part of the app.
  axeExclude: ['[data-mock-devtools]'],
  // brand-assets.zip in the fake library (prototype/data/media.json).
  archiveId: 1092,
  videoPosters: true,
})
