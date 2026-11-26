import { defineSliceTests } from '../support/slice.ts'

// The M2 slice against the mock build under /wp-upload-mock/ (the fake
// library; saved text lives only until the page reloads).
defineSliceTests({
  persists: false,
  slowWrites: { query: '&mock-latency=400' },
  // The mock's own dev scenario switcher isn't part of the app.
  axeExclude: ['[data-mock-devtools]'],
})
