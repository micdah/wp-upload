// The one keyboard dispatcher. It decides, per keydown, whether to ignore
// the key, hand Esc to the innermost layer, blur a text field, or run the
// matching binding's command.
//
// It stays out of the way of:
// - IME composition, and Alt/AltGr chords (AltGr types `@ $ [ ]` on DK);
// - text fields, except Esc (which leaves the field);
// - Enter and Space on a focused control (button, link, checkbox, tab, menu
//   item, …), which activate it natively;
// - open modals (aria-modal), menus, listboxes and expanded comboboxes or
//   listbox triggers, which handle their own keys (Mantine closes them on
//   Esc). An expanded Menu or Popover *button* is not one: Esc there goes to
//   the Popover's key layer;
// - anything inside [data-mm-local-keys] (the folder tree, the crop box, …);
// - inert regions, and while a [data-mm-keymap-suspended] element is shown
//   (onboarding and blocking screens);
// - keys a component already handled (event.defaultPrevented).
//
// The focus context is read in a window capture listener, *before* any
// other handler runs: Mantine closes a menu or modal on Esc and React may
// re-render before the event bubbles to us, which would otherwise make the
// same Esc also close detail mode. The top Esc layer is snapshotted there
// too: when Mantine closes a Popover that registered a layer, React removes
// the layer before the bubble listener runs. See spike C4
// (tracks/spikes/C4.md).

import { commandAvailability, runCommand } from '../commands/registry'
import { type KeyMode, listBindings, type RegisteredBinding } from './bindings'
import { type KeyLayer, topKeyLayer } from './layers'

export interface KeyEventLike {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
  repeat?: boolean
  isComposing?: boolean
  keyCode?: number
  defaultPrevented?: boolean
  getModifierState?(key: string): boolean
}

/** Where the key happened, as far as suspension is concerned. */
export interface FocusContext {
  textField: boolean
  modal: boolean
  popup: boolean
  localKeys: boolean
  suspended: boolean
  /** A button, link, checkbox, tab, menu item, … (Enter/Space activate it). */
  control: boolean
}

export const NO_CONTEXT: FocusContext = Object.freeze({
  textField: false,
  modal: false,
  popup: false,
  localKeys: false,
  suspended: false,
  control: false,
})

export type KeyDecision =
  | { kind: 'ignore'; why: string }
  | { kind: 'blur' }
  | { kind: 'layer'; layer: KeyLayer }
  | { kind: 'run'; binding: RegisteredBinding }
  | { kind: 'unavailable'; binding: RegisteredBinding }

/** Characters compare lowercase (Caps Lock); named keys as they are. */
export function normaliseKey(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key
}

const LETTER = /^[a-z]$/

export function matchesBinding(
  binding: RegisteredBinding,
  event: KeyEventLike,
  mode: KeyMode,
): boolean {
  const key = normaliseKey(event.key)
  if (binding.key !== key) {
    return false
  }
  if (binding.mode !== 'any' && binding.mode !== mode) {
    return false
  }
  const mod = event.ctrlKey || event.metaKey
  if (Boolean(binding.mod) !== mod) {
    return false
  }
  // Shift is part of the character for digits and punctuation (`?` and `+`
  // need it on US but not on DK), so it only counts for named keys and
  // letters (Shift+X is not X, Ctrl+Shift+Z is not Ctrl+Z).
  const shiftCounts = key.length > 1 || LETTER.test(key)
  if (shiftCounts && Boolean(binding.shift) !== event.shiftKey) {
    return false
  }
  return true
}

function isAltGraph(event: KeyEventLike): boolean {
  return event.altKey || Boolean(event.getModifierState?.('AltGraph'))
}

export interface DecideInput {
  event: KeyEventLike
  context: FocusContext
  mode: KeyMode
  bindings: readonly RegisteredBinding[]
  layer: KeyLayer | null
  isAvailable(binding: RegisteredBinding): boolean
}

/** The pure decision (unit-tested over the US/DK event matrix). */
export function decideKey(input: DecideInput): KeyDecision {
  const { event, context, mode, bindings, layer } = input
  if (event.defaultPrevented) {
    return { kind: 'ignore', why: 'handled' }
  }
  if (event.isComposing || event.keyCode === 229) {
    return { kind: 'ignore', why: 'ime' }
  }
  if (isAltGraph(event)) {
    return { kind: 'ignore', why: 'alt' }
  }
  if (context.suspended) {
    return { kind: 'ignore', why: 'suspended' }
  }
  if (context.modal) {
    return { kind: 'ignore', why: 'modal' }
  }
  if (context.popup) {
    return { kind: 'ignore', why: 'popup' }
  }
  if (context.localKeys) {
    return { kind: 'ignore', why: 'local' }
  }
  const isEscape = event.key === 'Escape'
  if (context.textField) {
    const plainEscape =
      isEscape && !event.ctrlKey && !event.metaKey && !event.shiftKey
    return plainEscape
      ? { kind: 'blur' }
      : { kind: 'ignore', why: 'text-field' }
  }
  const activation =
    (event.key === 'Enter' || event.key === ' ') &&
    !event.ctrlKey &&
    !event.metaKey
  if (context.control && activation) {
    return { kind: 'ignore', why: 'control' }
  }
  if (isEscape && layer !== null && !event.ctrlKey && !event.metaKey) {
    return { kind: 'layer', layer }
  }
  const binding = bindings.find((candidate) =>
    matchesBinding(candidate, event, mode),
  )
  if (!binding) {
    return { kind: 'ignore', why: 'unbound' }
  }
  if (event.repeat && !binding.repeat) {
    return { kind: 'ignore', why: 'repeat' }
  }
  return input.isAvailable(binding)
    ? { kind: 'run', binding }
    : { kind: 'unavailable', binding }
}

// ---------------------------------------------------------------------------
// DOM side
// ---------------------------------------------------------------------------

const NON_TEXT_INPUTS = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
])

export function isTextField(element: Element | null): boolean {
  if (!element) {
    return false
  }
  if (element instanceof HTMLElement && element.isContentEditable) {
    return true
  }
  const tag = element.tagName
  if (tag === 'TEXTAREA' || tag === 'SELECT') {
    return true
  }
  if (tag !== 'INPUT') {
    return false
  }
  return !NON_TEXT_INPUTS.has((element as HTMLInputElement).type)
}

const POPUP_SELECTOR = '[role="menu"], [role="menubar"], [role="listbox"]'

function isShown(element: Element): boolean {
  return element.getClientRects().length > 0
}

function openModal(doc: Document): boolean {
  for (const element of doc.querySelectorAll('[aria-modal="true"]')) {
    if (isShown(element)) {
      return true
    }
  }
  return false
}

/**
 * What Enter and Space activate natively. Grid tiles are `gridcell`s and the
 * folder tree sits under [data-mm-local-keys], so neither matches.
 */
export const CONTROL_SELECTOR = [
  'button',
  'a[href]',
  'summary',
  'input[type="button"]',
  'input[type="submit"]',
  'input[type="reset"]',
  'input[type="checkbox"]',
  'input[type="radio"]',
  'input[type="file"]',
  '[role="button"]',
  '[role="link"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]',
  '[role="option"]',
].join(', ')

/**
 * An expanded trigger whose own keydown closes its popup on Esc: a combobox
 * input (Mantine Select, Autocomplete, Combobox) or a listbox trigger. A
 * Menu or Popover button doesn't handle Esc, so it isn't one (spike C4).
 */
export function isExpandedComboboxTrigger(
  attribute: (name: string) => string | null,
): boolean {
  if (attribute('aria-expanded') !== 'true') {
    return false
  }
  return (
    attribute('role') === 'combobox' || attribute('aria-haspopup') === 'listbox'
  )
}

/** Reads the focus context for a key event's target. */
export function readFocusContext(
  target: EventTarget | null,
  doc: Document = document,
): FocusContext {
  const element =
    target instanceof Element &&
    target !== doc.body &&
    target !== doc.documentElement
      ? target
      : doc.activeElement instanceof Element
        ? doc.activeElement
        : null
  const attribute = (name: string) => element?.getAttribute(name) ?? null
  return {
    textField: isTextField(element),
    modal: openModal(doc),
    popup:
      Boolean(element?.closest(POPUP_SELECTOR)) ||
      isExpandedComboboxTrigger(attribute),
    localKeys: Boolean(element?.closest('[data-mm-local-keys]')),
    suspended:
      Boolean(element?.closest('[inert]')) ||
      doc.querySelector('[data-mm-keymap-suspended]') !== null,
    control: Boolean(element?.matches(CONTROL_SELECTOR)),
  }
}

/** The event as the dispatcher handles it. */
export interface DispatchedEvent extends KeyEventLike {
  preventDefault(): void
}

export interface KeyDispatcherOptions<E extends DispatchedEvent> {
  getMode(): KeyMode
  /** The focus context of an event (read in the capture phase). */
  readContext(event: E): FocusContext
  getLayer(): KeyLayer | null
  /** Leaves the focused text field (Esc). */
  blur(): void
  onDecision?(decision: KeyDecision, event: E): void
}

export interface KeyDispatcher<E extends DispatchedEvent> {
  /** The window capture listener: snapshots the context and the top layer. */
  capture(event: E): void
  /** The window bubble listener: decides and acts. */
  bubble(event: E): void
}

/**
 * The dispatcher without the window: what installKeymap() wires up, and
 * what the tests drive with fake events.
 */
export function createKeyDispatcher<E extends DispatchedEvent>(
  options: KeyDispatcherOptions<E>,
): KeyDispatcher<E> {
  const snapshots = new WeakMap<
    E,
    { context: FocusContext; layer: KeyLayer | null }
  >()
  const snapshot = (event: E) => ({
    context: options.readContext(event),
    layer: options.getLayer(),
  })
  return {
    capture(event) {
      snapshots.set(event, snapshot(event))
    },
    bubble(event) {
      const { context, layer } = snapshots.get(event) ?? snapshot(event)
      const decision = decideKey({
        event,
        context,
        mode: options.getMode(),
        bindings: listBindings(),
        layer,
        isAvailable: (binding) =>
          commandAvailability(binding.command, binding.args as never).ok,
      })
      options.onDecision?.(decision, event)
      switch (decision.kind) {
        case 'blur':
          event.preventDefault()
          options.blur()
          break
        case 'layer':
          event.preventDefault()
          decision.layer.onEscape()
          break
        case 'run':
          event.preventDefault()
          runCommand(decision.binding.command, decision.binding.args as never)
          break
        default:
          break
      }
    },
  }
}

export interface InstallOptions {
  /** The current mode: `detail` while `?item=` is set. */
  getMode(): KeyMode
  win?: Window
  /** Called for every decision (spikes and debugging). */
  onDecision?(decision: KeyDecision, event: KeyboardEvent): void
}

/** Installs the dispatcher on the window; returns the uninstall function. */
export function installKeymap(options: InstallOptions): () => void {
  const win = options.win ?? window
  const doc = win.document
  const dispatcher = createKeyDispatcher<KeyboardEvent>({
    getMode: options.getMode,
    readContext: (event) => readFocusContext(event.target, doc),
    getLayer: topKeyLayer,
    blur: () => {
      const active = doc.activeElement
      if (active instanceof HTMLElement) {
        active.blur()
      }
    },
    onDecision: options.onDecision,
  })
  const capture = (event: KeyboardEvent) => dispatcher.capture(event)
  const bubble = (event: KeyboardEvent) => dispatcher.bubble(event)
  win.addEventListener('keydown', capture, { capture: true })
  // Bubble phase on the window: React's handlers (on the root) run first and
  // can claim a key with preventDefault().
  win.addEventListener('keydown', bubble)
  return () => {
    win.removeEventListener('keydown', capture, { capture: true })
    win.removeEventListener('keydown', bubble)
  }
}
