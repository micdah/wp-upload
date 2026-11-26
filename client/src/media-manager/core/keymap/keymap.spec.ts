import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  type Binding,
  formatShortcut,
  layoutProblem,
  listBindings,
  type RegisteredBinding,
  registerBindings,
  resetBindingsForTesting,
  sheetBindings,
} from './bindings'
import { DEFAULT_BINDINGS } from './defaultBindings'
import {
  decideKey,
  type FocusContext,
  type KeyEventLike,
  NO_CONTEXT,
} from './dispatch'
import type { KeyLayer } from './layers'

function key(partial: Partial<KeyEventLike> & { key: string }): KeyEventLike {
  return {
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...partial,
  }
}

function decide(
  event: KeyEventLike,
  options: {
    mode?: 'grid' | 'detail'
    context?: Partial<FocusContext>
    layer?: KeyLayer | null
    available?: (binding: RegisteredBinding) => boolean
  } = {},
) {
  return decideKey({
    event,
    context: { ...NO_CONTEXT, ...options.context },
    mode: options.mode ?? 'grid',
    bindings: listBindings(),
    layer: options.layer ?? null,
    isAvailable: options.available ?? (() => true),
  })
}

function ranCommand(decision: ReturnType<typeof decide>): string | null {
  return decision.kind === 'run' ? decision.binding.command : null
}

beforeEach(() => {
  registerBindings('core', DEFAULT_BINDINGS)
})

afterEach(() => {
  resetBindingsForTesting()
})

describe('layout rule', () => {
  it('the default keymap is the spec’s 39 bindings, all layout-safe and conflict-free', () => {
    expect(DEFAULT_BINDINGS).toHaveLength(40)
    for (const binding of DEFAULT_BINDINGS) {
      expect(layoutProblem(binding), binding.command).toBeNull()
    }
  })

  it.each([
    ['['],
    [']'],
    ['{'],
    ['}'],
    ['\\'],
    ['|'],
    ['@'],
    ['$'],
    ['~'],
    ['F1'],
    ['F12'],
    ['Z'],
    ['/'],
    ['*'],
  ])('rejects %s', (forbidden) => {
    expect(layoutProblem({ key: forbidden })).not.toBeNull()
  })

  it('allows Ctrl/Cmd only with a letter or Enter, and Shift only where it counts', () => {
    expect(layoutProblem({ key: 'k', mod: true })).toBeNull()
    expect(layoutProblem({ key: 'Enter', mod: true })).toBeNull()
    expect(layoutProblem({ key: 'z', mod: true, shift: true })).toBeNull()
    expect(layoutProblem({ key: '1', mod: true })).not.toBeNull()
    expect(layoutProblem({ key: '?', shift: true })).not.toBeNull()
    expect(layoutProblem({ key: 'x', shift: true })).not.toBeNull()
    expect(layoutProblem({ key: 'Delete', shift: true })).toBeNull()
  })

  it('registerBindings throws on a layout violation', () => {
    const bad = [
      { key: '[', mode: 'any', command: 'help.shortcuts' },
    ] as const satisfies readonly Binding[]
    expect(() => registerBindings('folders', bad)).toThrow(/not typable/)
  })

  it('registerBindings throws on a conflict, including across modes with "any"', () => {
    expect(() =>
      registerBindings('folders', [
        { key: 'f', mode: 'grid', command: 'folders.create' },
      ]),
    ).toThrow(/conflicts with core's panels.toggle-folders/)
    // L is grid-only in core, so detail mode may bind it.
    expect(() =>
      registerBindings('peek', [
        { key: 'l', mode: 'detail', command: 'peek.toggle' },
      ]),
    ).not.toThrow()
    // Space is the grid's peek and detail's play / pause.
    expect(() =>
      registerBindings('player', [
        { key: ' ', mode: 'detail', command: 'peek.toggle' },
      ]),
    ).toThrow(/conflicts with core's detail.play-toggle/)
    expect(() =>
      registerBindings('x', [
        { key: 'q', mode: 'any', command: 'help.shortcuts' },
        { key: 'q', mode: 'grid', command: 'palette.open' },
      ]),
    ).toThrow(/conflicts/)
  })

  it('the ? sheet lists the folder keys only with FileBird (A3 CR-5)', () => {
    const folderKeys = (bindings: readonly RegisteredBinding[]) =>
      bindings
        .filter((binding) => binding.group === 'Folders')
        .map((binding) => binding.key)
    expect(folderKeys(sheetBindings({ filebird: true }))).toEqual([
      'n',
      'r',
      'm',
      'ContextMenu',
    ])
    expect(folderKeys(sheetBindings({ filebird: false }))).toEqual([])
    // Hidden bindings never show; the keys themselves stay registered.
    expect(
      sheetBindings({ filebird: true }).some((binding) => binding.hidden),
    ).toBe(false)
    expect(listBindings().some((binding) => binding.key === 'n')).toBe(true)
  })

  it('formats shortcuts for Mac and others', () => {
    expect(formatShortcut({ key: 'k', mod: true }, false)).toBe('Ctrl+K')
    expect(formatShortcut({ key: 'k', mod: true }, true)).toBe('⌘K')
    expect(formatShortcut({ key: 'Delete', shift: true }, false)).toBe(
      'Shift+Delete',
    )
    expect(formatShortcut({ key: ' ' }, false)).toBe('Space')
  })
})

describe('US and DK event matrix', () => {
  // How each layout reports the keys our bindings use (event.key + modifiers).
  const matrix: [string, KeyEventLike, string | null][] = [
    ['? on US (Shift+/)', key({ key: '?', shiftKey: true }), 'help.shortcuts'],
    ['? on DK (Shift++)', key({ key: '?', shiftKey: true }), 'help.shortcuts'],
    [
      '+ on US (Shift+=)',
      key({ key: '+', shiftKey: true }),
      'grid.density-step',
    ],
    ['+ on DK (unshifted)', key({ key: '+' }), 'grid.density-step'],
    ['+ on the numpad', key({ key: '+' }), 'grid.density-step'],
    ['- on both', key({ key: '-' }), 'grid.density-step'],
    ['f', key({ key: 'f' }), 'panels.toggle-folders'],
    ['F with Caps Lock', key({ key: 'F' }), 'panels.toggle-folders'],
    ['Shift+X is not X', key({ key: 'X', shiftKey: true }), null],
    ['Ctrl+K', key({ key: 'k', ctrlKey: true }), 'palette.open'],
    ['Cmd+K', key({ key: 'k', metaKey: true }), 'palette.open'],
    ['Ctrl+Z', key({ key: 'z', ctrlKey: true }), 'undo.last'],
    [
      'Ctrl+Shift+Z is not undo',
      key({ key: 'Z', ctrlKey: true, shiftKey: true }),
      null,
    ],
    ['Ctrl+F is not F', key({ key: 'f', ctrlKey: true }), null],
    ['Shift+Delete', key({ key: 'Delete', shiftKey: true }), 'items.delete'],
    [
      'Shift+ArrowRight extends',
      key({ key: 'ArrowRight', shiftKey: true }),
      'grid.move-focus',
    ],
    ['Space', key({ key: ' ' }), 'peek.toggle'],
  ]

  it.each(matrix)('%s', (_label, event, command) => {
    expect(ranCommand(decide(event))).toBe(command)
  })

  it('passes the binding’s arguments', () => {
    const decision = decide(key({ key: 'Delete', shiftKey: true }))
    expect(decision.kind === 'run' && decision.binding.args).toEqual({
      fromLibrary: true,
    })
  })

  it.each([
    [
      'DK AltGr+2 (@) on Windows: Ctrl+Alt',
      key({ key: '@', ctrlKey: true, altKey: true }),
    ],
    [
      'DK AltGr+8 ([) on Linux: AltGraph',
      {
        ...key({ key: '[' }),
        getModifierState: (m: string) => m === 'AltGraph',
      },
    ],
    [
      'AltGr on a letter (DK AltGr+e = €)',
      key({ key: '€', ctrlKey: true, altKey: true }),
    ],
    ['Option+f on Mac', key({ key: 'ƒ', altKey: true })],
    ['Alt+f', key({ key: 'f', altKey: true })],
  ])('rejects %s', (_label, event) => {
    expect(decide(event)).toMatchObject({ kind: 'ignore', why: 'alt' })
  })

  it('ignores IME composition', () => {
    expect(decide(key({ key: 'f', isComposing: true }))).toMatchObject({
      why: 'ime',
    })
    expect(decide(key({ key: 'Process', keyCode: 229 }))).toMatchObject({
      why: 'ime',
    })
  })
})

describe('modes, suspension and layering', () => {
  it('picks the binding for the current mode', () => {
    expect(
      ranCommand(decide(key({ key: 'ArrowLeft' }), { mode: 'grid' })),
    ).toBe('grid.move-focus')
    expect(
      ranCommand(decide(key({ key: 'ArrowLeft' }), { mode: 'detail' })),
    ).toBe('detail.step')
    expect(ranCommand(decide(key({ key: 'Escape' }), { mode: 'grid' }))).toBe(
      'selection.clear',
    )
    expect(ranCommand(decide(key({ key: 'Escape' }), { mode: 'detail' }))).toBe(
      'detail.close',
    )
    expect(ranCommand(decide(key({ key: 'g' }), { mode: 'grid' }))).toBeNull()
  })

  it('in a text field only Esc does something (it leaves the field)', () => {
    const context = { textField: true }
    expect(decide(key({ key: 'f' }), { context })).toMatchObject({
      kind: 'ignore',
      why: 'text-field',
    })
    expect(decide(key({ key: 'Delete' }), { context })).toMatchObject({
      why: 'text-field',
    })
    expect(decide(key({ key: 'k', ctrlKey: true }), { context })).toMatchObject(
      { why: 'text-field' },
    )
    expect(decide(key({ key: 'Escape' }), { context, mode: 'detail' })).toEqual(
      { kind: 'blur' },
    )
  })

  it.each([
    ['modal', { modal: true }],
    ['menu or listbox', { popup: true }],
    ['local keys', { localKeys: true }],
    ['suspended (onboarding, inert)', { suspended: true }],
  ])('stays out of a %s, Esc included', (_label, context) => {
    expect(decide(key({ key: 'f' }), { context }).kind).toBe('ignore')
    expect(
      decide(key({ key: 'Escape' }), { context, mode: 'detail' }).kind,
    ).toBe('ignore')
  })

  it('Esc goes to the innermost layer before any binding', () => {
    const layer: KeyLayer = { name: 'peek', onEscape: () => {} }
    expect(decide(key({ key: 'Escape' }), { layer, mode: 'detail' })).toEqual({
      kind: 'layer',
      layer,
    })
    // Other keys still reach the bindings.
    expect(ranCommand(decide(key({ key: 'ArrowRight' }), { layer }))).toBe(
      'grid.move-focus',
    )
  })

  it('a key a component already handled is left alone', () => {
    expect(decide(key({ key: 'f', defaultPrevented: true }))).toMatchObject({
      why: 'handled',
    })
  })

  it('repeats only bindings that allow it', () => {
    expect(ranCommand(decide(key({ key: 'ArrowRight', repeat: true })))).toBe(
      'grid.move-focus',
    )
    expect(decide(key({ key: 'f', repeat: true }))).toMatchObject({
      why: 'repeat',
    })
  })

  it('reports an unavailable command without running it', () => {
    const decision = decide(key({ key: 'u' }), { available: () => false })
    expect(decision.kind).toBe('unavailable')
  })
})
