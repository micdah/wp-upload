// System feature (Stage 4, Agent C): upload, delete and trash, system states,
// shortcut sheet and command palette, and the tablet/phone fallbacks. Each
// area lives in its own system-*.js module; this file only wires them up.

import { registerFeature } from '../features.js'
import { initCommands } from './system-commands.js'
import { initDelete } from './system-delete.js'
import { initPhone } from './system-phone.js'
import { initStates } from './system-states.js'
import { initUpload } from './system-upload.js'

registerFeature({
  init() {
    initStates()
    initUpload()
    initDelete()
    initCommands()
    initPhone()
  },
})
