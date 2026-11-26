// No text selection over the chrome, without `user-select: none`.
//
// Quick taps on Next (iPad feel review) started a text selection over the
// detail bar: the second tap counts as a double-click, and the browser
// selects the word under it. `user-select: none` stopped that, but it also
// cut the iPad off from its keyboard (branch mm/m2-keys):
//
// - In iPadOS Safari, a hardware keyboard's keys reach the page only while
//   the web view is the first responder. A finger tap makes it one
//   (WebKit's single-tap handler), but a click with the Magic Keyboard's
//   trackpad is delivered as a plain mouse event and doesn't. What does
//   make the web view the first responder then is UIKit's text interaction,
//   and WebKit refuses to start that over `user-select: none` content.
// - With the toolbar, rail, grid, tiles and detail's bar and stage all
//   `user-select: none`, nothing the owner clicked made the page the first
//   responder, so no shortcut reached it: not the arrows, not Esc, F or I.
//
// So the chrome stays selectable as far as the browser is concerned, and
// this guard cancels `selectstart` there instead. Every engine dispatches
// it before a pointer starts a selection (the double-click word selection
// and drag selection), and cancelling it changes neither focus nor clicks.
// Regions opt in with NO_SELECT_ATTRIBUTE; fields inside them (and anything
// under [data-mm-selectable]) keep their selection.

/** Marks a region of chrome whose text pointer gestures shouldn't select. */
export const NO_SELECT_ATTRIBUTE = 'data-mm-no-select'

/** The props that mark an element as such a region. */
export const noSelectProps = { [NO_SELECT_ATTRIBUTE]: '' } as const

const KEEPS_SELECTION =
  'input, textarea, select, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"], [data-mm-selectable]'

function elementOf(target: EventTarget | null): Element | null {
  if (target instanceof Element) {
    return target
  }
  if (target instanceof Node) {
    return target.parentElement
  }
  return null
}

/** Whether a selection starting at `target` should be cancelled. */
export function blocksSelectionAt(target: EventTarget | null): boolean {
  const element = elementOf(target)
  if (!element) {
    return false
  }
  const region = element.closest(`[${NO_SELECT_ATTRIBUTE}]`)
  if (!region) {
    return false
  }
  // A field (or opted-out text) inside the region keeps its selection.
  const keeper = element.closest(KEEPS_SELECTION)
  return keeper === null || !region.contains(keeper)
}

/**
 * Cancels `selectstart` over the chrome regions; returns the uninstall
 * function.
 */
export function installSelectionGuard(doc: Document = document): () => void {
  const onSelectStart = (event: Event) => {
    if (blocksSelectionAt(event.target)) {
      event.preventDefault()
    }
  }
  doc.addEventListener('selectstart', onSelectStart, { capture: true })
  return () => {
    doc.removeEventListener('selectstart', onSelectStart, { capture: true })
  }
}
