// Feature modules (Stage 4). Each registers itself with registerFeature()
// from ../features.js and owns its own files:
//   folders-ops.js — Agent A: folder CRUD, drag to folder, Move to…, Pro colours
//   inspector-edit.js — Agent B: inspector panels, batch edit, image editing
//   system.js — Agent C: upload, delete/trash, system states, shortcuts, phone
import './folders-ops.js'
import './inspector-edit.js'
import './system.js'
