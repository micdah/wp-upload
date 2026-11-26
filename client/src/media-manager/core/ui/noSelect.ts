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
//   and WebKit refuses to start that where the element under the pointer is
//   `user-select: none` (WebKit's selectionPositionInformation).
// - With the toolbar, rail, grid, tiles and detail's bar and stage all
//   `user-select: none`, nothing the owner clicked made the page the first
//   responder, so no shortcut reached it: not the arrows, not Esc, F or I.
//
// So the chrome stays selectable as far as the browser is concerned, and
// this guard keeps selections out of it in two ways (mm/m2-select):
//
// 1. It cancels `selectstart`. Engines dispatch it before a mouse starts a
//    selection through the page's own event handling (a double-click's
//    word, a drag), and cancelling it changes neither focus nor clicks.
//    That covers desktop browsers.
// 2. It removes a selection that ends up in the chrome anyway. On the iPad,
//    a trackpad drag or a quick double-click is a UIKit text-selection
//    gesture: WebKit sets the selection directly, without `selectstart`.
//    Every engine reports the change with `selectionchange`, so a range
//    whose anchor or focus lies in a region is dropped then. The gesture
//    has already made the web view the first responder by that point, and
//    dropping the selection doesn't change focus, so the keyboard stays.
//    Carets (collapsed selections) are invisible and left alone.
//
// Regions opt in with NO_SELECT_ATTRIBUTE. Fields inside them, anything
// under [data-mm-selectable], and every selection while a field has focus
// are left alone.

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
 * Whether the document's selection is a range over the chrome that should
 * go: its anchor or focus lies in a region, and no field has focus (a
 * field's own selection is reported at the field's place in its parent).
 */
export function selectionToDrop(
  selection: Selection | null,
  doc: Document = document,
): boolean {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return false
  }
  if (doc.activeElement?.closest(KEEPS_SELECTION)) {
    return false
  }
  return (
    blocksSelectionAt(selection.anchorNode) ||
    blocksSelectionAt(selection.focusNode)
  )
}

/**
 * Cancels `selectstart` over the chrome regions and drops any range that
 * still ends up there; returns the uninstall function.
 */
export function installSelectionGuard(doc: Document = document): () => void {
  const onSelectStart = (event: Event) => {
    if (blocksSelectionAt(event.target)) {
      event.preventDefault()
    }
  }
  const onSelectionChange = () => {
    const selection = doc.getSelection()
    if (selectionToDrop(selection, doc)) {
      selection?.removeAllRanges()
    }
  }
  doc.addEventListener('selectstart', onSelectStart, { capture: true })
  doc.addEventListener('selectionchange', onSelectionChange)
  return () => {
    doc.removeEventListener('selectstart', onSelectStart, { capture: true })
    doc.removeEventListener('selectionchange', onSelectionChange)
  }
}
