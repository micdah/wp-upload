// The `grid` feature: the justified/square grid, tiles and selection
// (interaction-spec §2). Built in M2 as the vertical slice and extended by
// track A1 in wave A: badges, non-image cards, the upload state, the "just
// changed" flash, the check circle, the selection bar, the layout and
// density controls, and the empty states.
// The shell imports these exports directly: keep their names.

import { implementCommand } from '../../core/commands/registry'
import { registerToolbarItem } from '../../shell/slots'
import { moveFocus, moveFocusAvailability } from './controller'
import { SelectionBar } from './SelectionBar'
import { ViewControls } from './ViewControls'

export { flashTiles } from './flash'
export { GridView } from './GridView'

let registered = false

/** Wires the grid's commands and toolbar controls. Idempotent. */
export function register(): void {
  if (registered) {
    return
  }
  registered = true
  implementCommand('grid.move-focus', {
    available: () => moveFocusAvailability(),
    run: (args) => moveFocus(args.to, args.mode),
  })
  // The selection bar comes first in the centre slot: while it shows, it
  // covers the toolbar and hides the controls after it.
  registerToolbarItem({
    id: 'grid.selection-bar',
    slot: 'center',
    order: 0,
    Component: SelectionBar,
  })
  registerToolbarItem({
    id: 'grid.view-controls',
    slot: 'center',
    order: 30,
    Component: ViewControls,
  })
}
