import { defineA1Tests } from './a1-flows.ts'

// Track A1's flows against the mock build under /wp-upload-mock/ (the fake
// library).
defineA1Tests({
  // The mock's own dev scenario switcher isn't part of the app.
  axeExclude: ['[data-mock-devtools]'],
})
