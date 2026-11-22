import { register as registerCommandUi } from '../features/command-ui'
import { register as registerDetail } from '../features/detail'
import { register as registerEditor } from '../features/editor'
import { register as registerFilters } from '../features/filters'
import { register as registerFolders } from '../features/folders'
import { register as registerGrid } from '../features/grid'
import { register as registerInspector } from '../features/inspector'
import { register as registerPeek } from '../features/peek'
import { register as registerPhone } from '../features/phone'
import { register as registerSystem } from '../features/system'
import { register as registerTrash } from '../features/trash'
import { register as registerUpload } from '../features/upload'

// Calls every feature's register() once at start-up, in a fixed order, so
// features can add commands, key bindings and palette sources without
// editing shared files. Orchestrator-owned after the M2 gate (plan §4).
export function registerFeatures(): void {
  registerGrid()
  registerFilters()
  registerPeek()
  registerDetail()
  registerFolders()
  registerInspector()
  registerEditor()
  registerUpload()
  registerTrash()
  registerSystem()
  registerCommandUi()
  registerPhone()
}
