// The dispatcher fixes from spike C4 (tracks/spikes/C4.md): Enter/Space on
// a focused control, the Esc layer snapshotted at capture time, and which
// expanded triggers count as popups.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { implementCommand, resetCommandsForTesting } from '../commands/registry'
import {
  listBindings,
  registerBindings,
  resetBindingsForTesting,
} from './bindings'
import { DEFAULT_BINDINGS } from './defaultBindings'
import {
  createKeyDispatcher,
  type DispatchedEvent,
  decideKey,
  type FocusContext,
  isExpandedComboboxTrigger,
  type KeyDecision,
  NO_CONTEXT,
} from './dispatch'
import type { KeyLayer } from './layers'

interface FakeEvent extends DispatchedEvent {
  prevented: boolean
}

function keyEvent(key: string, extra: Partial<FakeEvent> = {}): FakeEvent {
  const event: FakeEvent = {
    key,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    prevented: false,
    preventDefault() {
      event.prevented = true
    },
    ...extra,
  }
  return event
}

const CONTROL: FocusContext = { ...NO_CONTEXT, control: true }

beforeEach(() => {
  registerBindings('core', DEFAULT_BINDINGS)
})

afterEach(() => {
  resetBindingsForTesting()
  resetCommandsForTesting()
})

function decideIn(
  context: FocusContext,
  event: FakeEvent,
  mode: 'grid' | 'detail' = 'grid',
) {
  return decideKey({
    event,
    context,
    mode,
    bindings: listBindings(),
    layer: null,
    isAvailable: () => true,
  })
}

describe('Enter and Space on a focused control', () => {
  it.each([
    ['Enter', 'grid'],
    [' ', 'grid'],
    ['Enter', 'detail'],
  ] as const)('%s in %s mode is left to the control', (key, mode) => {
    expect(decideIn(CONTROL, keyEvent(key), mode)).toEqual({
      kind: 'ignore',
      why: 'control',
    })
  })

  it('other keys still reach the app from a control', () => {
    expect(decideIn(CONTROL, keyEvent('f')).kind).toBe('run')
    expect(decideIn(CONTROL, keyEvent('Escape'), 'detail').kind).toBe('run')
    expect(decideIn(CONTROL, keyEvent('a', { ctrlKey: true })).kind).toBe('run')
    expect(decideIn(CONTROL, keyEvent('Enter', { ctrlKey: true }))).toEqual({
      kind: 'ignore',
      why: 'unbound',
    })
  })

  it('without a control, Enter opens detail and Space peeks', () => {
    const enter = decideIn(NO_CONTEXT, keyEvent('Enter'))
    const space = decideIn(NO_CONTEXT, keyEvent(' '))
    expect(enter.kind === 'run' && enter.binding.command).toBe('detail.open')
    expect(space.kind === 'run' && space.binding.command).toBe('peek.toggle')
  })

  it('the dispatcher neither runs a command nor cancels the activation', () => {
    const open = vi.fn()
    implementCommand('detail.open', { run: open })
    const dispatcher = createKeyDispatcher<FakeEvent>({
      getMode: () => 'grid',
      readContext: () => CONTROL,
      getLayer: () => null,
      blur: () => {},
    })
    const event = keyEvent('Enter')
    dispatcher.capture(event)
    dispatcher.bubble(event)
    expect(open).not.toHaveBeenCalled()
    expect(event.prevented).toBe(false)
  })
})

describe('the Esc layer is snapshotted at capture time', () => {
  it('a layer removed between capture and bubble still takes that Esc', () => {
    const close = vi.fn()
    implementCommand('detail.close', { run: close })
    const popover: KeyLayer = { name: 'popover', onEscape: vi.fn() }
    let layer: KeyLayer | null = popover
    const decisions: KeyDecision[] = []
    const dispatcher = createKeyDispatcher<FakeEvent>({
      getMode: () => 'detail',
      readContext: () => NO_CONTEXT,
      getLayer: () => layer,
      blur: () => {},
      onDecision: (decision) => decisions.push(decision),
    })
    const event = keyEvent('Escape')
    dispatcher.capture(event)
    // Mantine closes the Popover from its capture handler; React commits
    // and the layer's cleanup runs before our bubble listener.
    layer = null
    dispatcher.bubble(event)
    expect(close).not.toHaveBeenCalled()
    expect(popover.onEscape).toHaveBeenCalledTimes(1)
    expect(decisions[0]?.kind).toBe('layer')
    expect(event.prevented).toBe(true)
  })

  it('the next Esc, with no layer left, runs the binding', () => {
    const close = vi.fn()
    implementCommand('detail.close', { run: close })
    const dispatcher = createKeyDispatcher<FakeEvent>({
      getMode: () => 'detail',
      readContext: () => NO_CONTEXT,
      getLayer: () => null,
      blur: () => {},
    })
    const event = keyEvent('Escape')
    dispatcher.capture(event)
    dispatcher.bubble(event)
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('the focus context is snapshotted too (a modal closed by Mantine)', () => {
    const close = vi.fn()
    implementCommand('detail.close', { run: close })
    let context: FocusContext = { ...NO_CONTEXT, modal: true }
    const dispatcher = createKeyDispatcher<FakeEvent>({
      getMode: () => 'detail',
      readContext: () => context,
      getLayer: () => null,
      blur: () => {},
    })
    const event = keyEvent('Escape')
    dispatcher.capture(event)
    context = NO_CONTEXT
    dispatcher.bubble(event)
    expect(close).not.toHaveBeenCalled()
  })

  it('Esc in a text field blurs it', () => {
    const blur = vi.fn()
    const dispatcher = createKeyDispatcher<FakeEvent>({
      getMode: () => 'detail',
      readContext: () => ({ ...NO_CONTEXT, textField: true }),
      getLayer: () => null,
      blur,
    })
    const event = keyEvent('Escape')
    dispatcher.capture(event)
    dispatcher.bubble(event)
    expect(blur).toHaveBeenCalledTimes(1)
    expect(event.prevented).toBe(true)
  })
})

describe('which expanded triggers count as popups', () => {
  function attributes(values: Record<string, string>) {
    return (name: string) => values[name] ?? null
  }

  it.each([
    ['a combobox input', { 'aria-expanded': 'true', role: 'combobox' }, true],
    [
      'a listbox trigger',
      { 'aria-expanded': 'true', 'aria-haspopup': 'listbox' },
      true,
    ],
    [
      'a Menu button',
      { 'aria-expanded': 'true', 'aria-haspopup': 'menu' },
      false,
    ],
    [
      'a Popover button',
      { 'aria-expanded': 'true', 'aria-haspopup': 'dialog' },
      false,
    ],
    [
      'a collapsed combobox',
      { 'aria-expanded': 'false', role: 'combobox' },
      false,
    ],
  ])('%s → %s', (_label, values, expected) => {
    expect(isExpandedComboboxTrigger(attributes(values))).toBe(expected)
  })
})
