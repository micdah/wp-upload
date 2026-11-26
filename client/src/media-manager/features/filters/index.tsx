// The `filters` feature (track A1): search and sort in the toolbar, and the
// filter bar above the grid (interaction-spec §3). All of it is URL state.
// The shell imports these exports directly: keep their names.

import { registerToolbarItem } from '../../shell/slots'
import { SearchBox } from './SearchBox'
import { SortMenu } from './SortMenu'

export { FilterBar } from './FilterBar'

let registered = false

/** Puts search and sort into the toolbar. Idempotent. */
export function register(): void {
  if (registered) {
    return
  }
  registered = true
  registerToolbarItem({
    id: 'filters.search',
    slot: 'center',
    order: 10,
    Component: SearchBox,
  })
  registerToolbarItem({
    id: 'filters.sort',
    slot: 'center',
    order: 20,
    Component: SortMenu,
  })
}
