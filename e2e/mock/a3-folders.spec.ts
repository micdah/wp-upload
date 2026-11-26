import {
  defineFolderScenarioTests,
  defineFolderTests,
} from '../support/folders.ts'

// Track A3's folder column against the mock build under /wp-upload-mock/
// (the prototype's 16 folders; changes live until the page reloads), plus the
// mock-only per-user and no-FileBird scenarios.
const options = {
  persists: false,
  // The mock's own dev scenario switcher isn't part of the app.
  axeExclude: ['[data-mock-devtools]'],
}

defineFolderTests(options)
defineFolderScenarioTests(options)
