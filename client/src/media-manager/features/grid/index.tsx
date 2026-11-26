// The `grid` feature: the justified/square grid, tiles and selection
// (interaction-spec §2). Built in M2 as the vertical slice; track A1
// extends it in wave A (badges, upload state, peek, filters' empty states).
// The shell imports these exports directly: keep their names.

import { implementCommand } from '../../core/commands/registry'
import { moveFocus, moveFocusAvailability } from './controller'

export { GridView } from './GridView'

let registered = false

/** Wires the grid's commands. Idempotent. */
export function register(): void {
  if (registered) {
    return
  }
  registered = true
  implementCommand('grid.move-focus', {
    available: () => moveFocusAvailability(),
    run: (args) => moveFocus(args.to, args.mode),
  })
}
