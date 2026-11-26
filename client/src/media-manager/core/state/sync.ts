// Rules that tie URL changes to core state, whatever caused the change (a
// click, a command, or the browser's Back/Forward buttons):
//
// - changing folder clears the selection and focus (interaction-spec §1);
// - opening or stepping in detail mode moves focus to that item, so the grid
//   focuses the tile you return to; with 0 or 1 selected the selection moves
//   with it, with 2 or more it is kept (D52, selection.followDetailItem);
//   leaving detail keeps whatever the selection is then;
// - zoom resets to Fit when you step or leave (interaction-spec §5);
// - overlays (peek, …) close when detail opens or the folder changes.

import type { StoreApi } from 'zustand/vanilla'
import type { UrlStore } from '../url/history'
import type { CoreStore } from './store'

export function installCoreSync(
  url: UrlStore,
  core: StoreApi<CoreStore>,
): () => void {
  let previous = url.get()
  // A `?item=` deep link: follow it, so leaving detail lands on its tile.
  if (previous.item !== null) {
    core.getState().followDetailItem(previous.item)
  }
  return url.subscribe(() => {
    const next = url.get()
    const actions = core.getState()
    if (next.folder !== previous.folder) {
      actions.resetSelection()
      actions.closeOverlay()
    }
    if (next.item !== previous.item) {
      actions.setZoom('fit')
      if (next.item !== null) {
        actions.followDetailItem(next.item)
        if (previous.item === null) {
          actions.closeOverlay()
        }
      }
    }
    previous = next
  })
}
