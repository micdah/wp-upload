// The proposed core changes to dispatch.ts, tested in the spike (`?patched=1`).
// Each is a small delta on core's code, which this file otherwise copies:
//
// 1. The capture listener snapshots the top Esc layer as well as the focus
//    context. A feature's Popover registers useKeyLayer(name, close, opened).
//    When focus is inside its dropdown, Mantine closes it on Esc from the
//    dropdown's onKeyDownCapture; React commits and runs the layer's effect
//    cleanup in a microtask *before* our window bubble listener, so without
//    the snapshot the same Esc falls through to detail.close.
// 2. "Expanded popup trigger" only counts for comboboxes (role=combobox or
//    aria-haspopup=listbox), whose input handles Esc itself. A Popover or
//    Menu *button* with aria-expanded=true doesn't handle Esc, so treating it
//    as a popup swallowed Esc and the popover's layer never got it.
// 3. Enter and Space on a focused button/link/checkbox/menu item belong to
//    the control (native activation). Otherwise grid-mode Enter (detail.open)
//    and Space (peek.toggle) run *and* preventDefault() cancels the click.

import {
  commandAvailability,
  runCommand,
} from '../../../core/commands/registry'
import {
  decideKey,
  type FocusContext,
  type InstallOptions,
  isTextField,
  type KeyDecision,
  type KeyLayer,
  listBindings,
  topKeyLayer,
} from '../../../core/keymap'
import type { DecideInput } from '../../../core/keymap/dispatch'

export interface PatchedContext extends FocusContext {
  /** A control that Enter/Space activate natively. */
  control: boolean
}

const POPUP_SELECTOR = '[role="menu"], [role="menubar"], [role="listbox"]'

// Change 3: what Enter/Space activate natively. Grid tiles are gridcells and
// the folder tree is under [data-mm-local-keys], so neither is affected.
const CONTROL_SELECTOR = [
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
].join(', ')

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

export function readFocusContextPatched(
  target: EventTarget | null,
  doc: Document = document,
): PatchedContext {
  const element =
    target instanceof Element &&
    target !== doc.body &&
    target !== doc.documentElement
      ? target
      : doc.activeElement instanceof Element
        ? doc.activeElement
        : null
  const expanded = element?.getAttribute('aria-expanded') === 'true'
  // Change 2: only comboboxes, not every aria-haspopup trigger.
  const combobox =
    element?.getAttribute('role') === 'combobox' ||
    element?.getAttribute('aria-haspopup') === 'listbox'
  return {
    textField: isTextField(element),
    modal: openModal(doc),
    popup:
      Boolean(element?.closest(POPUP_SELECTOR)) ||
      Boolean(expanded && combobox),
    localKeys: Boolean(element?.closest('[data-mm-local-keys]')),
    suspended:
      Boolean(element?.closest('[inert]')) ||
      doc.querySelector('[data-mm-keymap-suspended]') !== null,
    control: Boolean(element?.matches(CONTROL_SELECTOR)),
  }
}

/** Change 3, as a guard in front of core's decideKey. */
export function decideKeyPatched(
  input: DecideInput & { context: PatchedContext },
): KeyDecision {
  const { event, context } = input
  const activation =
    (event.key === 'Enter' || event.key === ' ') &&
    !event.ctrlKey &&
    !event.metaKey
  if (context.control && activation && !event.defaultPrevented) {
    return { kind: 'ignore', why: 'control' }
  }
  return decideKey(input)
}

interface Snapshot {
  context: PatchedContext
  layer: KeyLayer | null
}

export function installKeymapPatched(options: InstallOptions): () => void {
  const win = options.win ?? window
  const doc = win.document
  const snapshots = new WeakMap<Event, Snapshot>()

  const snapshot = (event: KeyboardEvent): Snapshot => ({
    context: readFocusContextPatched(event.target, doc),
    // Change 1.
    layer: topKeyLayer(),
  })

  const capture = (event: KeyboardEvent) => {
    snapshots.set(event, snapshot(event))
  }

  const bubble = (event: KeyboardEvent) => {
    const { context, layer } = snapshots.get(event) ?? snapshot(event)
    const decision = decideKeyPatched({
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
      case 'blur': {
        const active = doc.activeElement
        if (active instanceof HTMLElement) {
          active.blur()
        }
        event.preventDefault()
        break
      }
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
  }

  win.addEventListener('keydown', capture, { capture: true })
  win.addEventListener('keydown', bubble)
  return () => {
    win.removeEventListener('keydown', capture, { capture: true })
    win.removeEventListener('keydown', bubble)
  }
}
