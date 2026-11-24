// US and Danish keyboard helpers for keymap tests (plan §8: "a US/DK event
// matrix, AltGr rejection").
//
// Shortcuts must be typable on both layouts: letters, digits, `, . - + ?`,
// named keys and Ctrl/Cmd+letter (tracks/README.md). These helpers describe
// what the browser reports when someone *types* a character on each layout,
// so a test can check that a binding fires for both — and that characters
// needing AltGr on a layout (DK `@ $ { [ ] } | \ ~ €`) never trigger one.
//
// Everything here works in Node (plain KeyStroke objects with
// getModifierState) and in the browser (toKeyboardEvent, pressKey).
//
//   for (const stroke of strokesFor('+')) {          // US Shift+=, DK +
//     expect(matchBinding(bindings, stroke)).toBe('zoom-in')
//   }
//   for (const stroke of strokesFor('[', { layouts: ['dk'] })) {
//     expect(stroke.altGraph).toBe(true)             // DK needs AltGr+8
//   }
//   const user = userEvent.setup({ keyboardMap: userEventKeyboardMap('dk') })

/**
 * One key on a layout. The shape is user-event's `keyboardKey`, so a layout
 * can be passed to `userEvent.setup({ keyboardMap })` unchanged.
 */
export interface LayoutKey {
  code: string
  key: string
  shift?: boolean
  altGr?: boolean
}

export type LayoutId = 'us' | 'dk'

export interface KeyboardLayout {
  id: LayoutId
  name: string
  keys: readonly LayoutKey[]
}

/** How the OS reports AltGr: Windows as Ctrl+Alt, Linux and macOS as AltGraph. */
export type AltGrStyle = 'ctrl-alt' | 'altgraph'

/** What a keydown reports. Usable as a KeyboardEvent stand-in in Node. */
export interface KeyStroke {
  type: 'keydown' | 'keyup'
  key: string
  code: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
  /** AltGraph modifier state (true for every AltGr character) */
  altGraph: boolean
  repeat: boolean
  isComposing: boolean
  layout: LayoutId | 'named'
  getModifierState(modifier: string): boolean
}

export interface ExtraModifiers {
  ctrl?: boolean
  meta?: boolean
  alt?: boolean
  shift?: boolean
}

// ---- Layout tables -----------------------------------------------------------

const LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('')

function letterKeys(): LayoutKey[] {
  return LETTERS.flatMap((letter) => {
    const code = `Key${letter.toUpperCase()}`
    return [
      { code, key: letter },
      { code, key: letter.toUpperCase(), shift: true },
    ]
  })
}

function digitKeys(shifted: string): LayoutKey[] {
  return '1234567890'.split('').flatMap((digit, index) => {
    const code = `Digit${digit}`
    return [
      { code, key: digit },
      { code, key: shifted[index] as string, shift: true },
    ]
  })
}

/** Keys with a fixed meaning on every layout (KeyboardEvent.key values). */
export const NAMED_KEYS = [
  'Enter',
  'Escape',
  'Tab',
  'Backspace',
  'Delete',
  'Insert',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  ' ',
  'F1',
  'F2',
  'F3',
  'F4',
  'F5',
  'F6',
  'F7',
  'F8',
  'F9',
  'F10',
  'F11',
  'F12',
] as const

const NAMED_KEY_CODES: Record<(typeof NAMED_KEYS)[number], string> = {
  Enter: 'Enter',
  Escape: 'Escape',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'ArrowUp',
  ArrowDown: 'ArrowDown',
  ArrowLeft: 'ArrowLeft',
  ArrowRight: 'ArrowRight',
  ' ': 'Space',
  F1: 'F1',
  F2: 'F2',
  F3: 'F3',
  F4: 'F4',
  F5: 'F5',
  F6: 'F6',
  F7: 'F7',
  F8: 'F8',
  F9: 'F9',
  F10: 'F10',
  F11: 'F11',
  F12: 'F12',
}

function namedKeys(): LayoutKey[] {
  return NAMED_KEYS.map((key) => ({ code: NAMED_KEY_CODES[key], key }))
}

/** US English (ANSI). */
export const US_LAYOUT: KeyboardLayout = {
  id: 'us',
  name: 'US English',
  keys: [
    ...letterKeys(),
    ...digitKeys('!@#$%^&*()'),
    { code: 'Backquote', key: '`' },
    { code: 'Backquote', key: '~', shift: true },
    { code: 'Minus', key: '-' },
    { code: 'Minus', key: '_', shift: true },
    { code: 'Equal', key: '=' },
    { code: 'Equal', key: '+', shift: true },
    { code: 'BracketLeft', key: '[' },
    { code: 'BracketLeft', key: '{', shift: true },
    { code: 'BracketRight', key: ']' },
    { code: 'BracketRight', key: '}', shift: true },
    { code: 'Backslash', key: '\\' },
    { code: 'Backslash', key: '|', shift: true },
    { code: 'Semicolon', key: ';' },
    { code: 'Semicolon', key: ':', shift: true },
    { code: 'Quote', key: "'" },
    { code: 'Quote', key: '"', shift: true },
    { code: 'Comma', key: ',' },
    { code: 'Comma', key: '<', shift: true },
    { code: 'Period', key: '.' },
    { code: 'Period', key: '>', shift: true },
    { code: 'Slash', key: '/' },
    { code: 'Slash', key: '?', shift: true },
    ...namedKeys(),
  ],
}

/**
 * Danish (ISO, Windows/Linux). Dead keys (´ ` ¨ ^ ~) are listed with the
 * character they report as `key` on Chromium ('Dead').
 */
export const DK_LAYOUT: KeyboardLayout = {
  id: 'dk',
  name: 'Danish',
  keys: [
    ...letterKeys(),
    ...digitKeys('!"#¤%&/()='),
    { code: 'Digit2', key: '@', altGr: true },
    { code: 'Digit3', key: '£', altGr: true },
    { code: 'Digit4', key: '$', altGr: true },
    { code: 'Digit5', key: '€', altGr: true },
    { code: 'Digit7', key: '{', altGr: true },
    { code: 'Digit8', key: '[', altGr: true },
    { code: 'Digit9', key: ']', altGr: true },
    { code: 'Digit0', key: '}', altGr: true },
    { code: 'KeyE', key: '€', altGr: true },
    { code: 'KeyM', key: 'µ', altGr: true },
    { code: 'Backquote', key: '½' },
    { code: 'Backquote', key: '§', shift: true },
    { code: 'Minus', key: '+' },
    { code: 'Minus', key: '?', shift: true },
    { code: 'Equal', key: 'Dead' },
    { code: 'Equal', key: 'Dead', shift: true },
    { code: 'Equal', key: '|', altGr: true },
    { code: 'BracketLeft', key: 'å' },
    { code: 'BracketLeft', key: 'Å', shift: true },
    { code: 'BracketRight', key: 'Dead' },
    { code: 'BracketRight', key: 'Dead', shift: true },
    { code: 'BracketRight', key: '~', altGr: true },
    { code: 'Semicolon', key: 'æ' },
    { code: 'Semicolon', key: 'Æ', shift: true },
    { code: 'Quote', key: 'ø' },
    { code: 'Quote', key: 'Ø', shift: true },
    { code: 'Backslash', key: "'" },
    { code: 'Backslash', key: '*', shift: true },
    { code: 'IntlBackslash', key: '<' },
    { code: 'IntlBackslash', key: '>', shift: true },
    { code: 'IntlBackslash', key: '\\', altGr: true },
    { code: 'Comma', key: ',' },
    { code: 'Comma', key: ';', shift: true },
    { code: 'Period', key: '.' },
    { code: 'Period', key: ':', shift: true },
    { code: 'Slash', key: '-' },
    { code: 'Slash', key: '_', shift: true },
    ...namedKeys(),
  ],
}

export const KEYBOARD_LAYOUTS: Record<LayoutId, KeyboardLayout> = {
  us: US_LAYOUT,
  dk: DK_LAYOUT,
}

/** The punctuation shortcuts may use: typable without AltGr on US and DK. */
export const SHORTCUT_PUNCTUATION = [',', '.', '-', '+', '?'] as const

// ---- Strokes ------------------------------------------------------------------

function makeStroke(
  entry: LayoutKey,
  layout: LayoutId | 'named',
  altGrStyle: AltGrStyle,
  extra: ExtraModifiers,
): KeyStroke {
  const altGraph = entry.altGr === true
  // Windows reports AltGr as Ctrl+Alt; Linux and macOS only set AltGraph.
  const altGrAsCtrlAlt = altGraph && altGrStyle === 'ctrl-alt'
  const stroke: KeyStroke = {
    type: 'keydown',
    key: entry.key,
    code: entry.code,
    ctrlKey: altGrAsCtrlAlt || extra.ctrl === true,
    metaKey: extra.meta === true,
    altKey: altGrAsCtrlAlt || extra.alt === true,
    shiftKey: entry.shift === true || extra.shift === true,
    altGraph,
    repeat: false,
    isComposing: false,
    layout,
    getModifierState(modifier: string): boolean {
      switch (modifier) {
        case 'Control':
          return stroke.ctrlKey
        case 'Meta':
          return stroke.metaKey
        case 'Alt':
          return stroke.altKey
        case 'Shift':
          return stroke.shiftKey
        case 'AltGraph':
          return stroke.altGraph
        default:
          return false
      }
    },
  }
  return stroke
}

export interface StrokeOptions {
  /** Layouts to include. Default: both. */
  layouts?: readonly LayoutId[]
  /** AltGr reporting styles to include for AltGr characters. Default: both. */
  altGrStyles?: readonly AltGrStyle[]
  /** Modifiers held in addition to what the character needs. */
  modifiers?: ExtraModifiers
}

/**
 * Every keydown that types `key` on the given layouts (default US and DK):
 * one per layout, or two for an AltGr character (one per AltGr style).
 * Empty if a layout can't type it at all. Named keys give one stroke.
 */
export function strokesFor(
  key: string,
  {
    layouts = ['us', 'dk'],
    altGrStyles = ['ctrl-alt', 'altgraph'],
    modifiers = {},
  }: StrokeOptions = {},
): KeyStroke[] {
  if ((NAMED_KEYS as readonly string[]).includes(key)) {
    const code = NAMED_KEY_CODES[key as (typeof NAMED_KEYS)[number]]
    return [makeStroke({ code, key }, 'named', 'altgraph', modifiers)]
  }
  return layouts.flatMap((layoutId) => {
    const entry = KEYBOARD_LAYOUTS[layoutId].keys.find(
      (candidate) => candidate.key === key,
    )
    if (!entry) {
      return []
    }
    if (entry.altGr) {
      return altGrStyles.map((style) =>
        makeStroke(entry, layoutId, style, modifiers),
      )
    }
    return [makeStroke(entry, layoutId, 'altgraph', modifiers)]
  })
}

/** The single stroke for `key` on one layout; throws if it can't be typed. */
export function strokeOn(
  layout: LayoutId,
  key: string,
  modifiers: ExtraModifiers = {},
): KeyStroke {
  const [stroke] = strokesFor(key, {
    layouts: [layout],
    altGrStyles: ['altgraph'],
    modifiers,
  })
  if (!stroke) {
    throw new Error(`'${key}' can't be typed on the ${layout} layout`)
  }
  return stroke
}

/** Ctrl/Cmd + letter, as a binding written `Mod+k` expects. */
export function modStroke(
  letter: string,
  platform: 'mac' | 'other' = 'other',
  modifiers: ExtraModifiers = {},
): KeyStroke {
  const mod = platform === 'mac' ? { meta: true } : { ctrl: true }
  return strokeOn('us', letter, { ...modifiers, ...mod })
}

/**
 * True if `key` can be typed on every layout without AltGr: the rule every
 * shortcut must satisfy.
 */
export function isTypableOnAllLayouts(key: string): boolean {
  if ((NAMED_KEYS as readonly string[]).includes(key)) {
    return true
  }
  return Object.values(KEYBOARD_LAYOUTS).every((layout) =>
    layout.keys.some((entry) => entry.key === key && !entry.altGr),
  )
}

/**
 * The shortcut policy itself (tracks/README.md): a letter, a digit, one of
 * `, . - + ?`, or a named key. Narrower than isTypableOnAllLayouts: `/` is
 * typable on both (DK Shift+7) but sits on different keys, so it's excluded.
 */
export function isShortcutSafeKey(key: string): boolean {
  if ((NAMED_KEYS as readonly string[]).includes(key)) {
    return true
  }
  if (/^[a-zA-Z0-9]$/.test(key)) {
    return true
  }
  return (SHORTCUT_PUNCTUATION as readonly string[]).includes(key)
}

/**
 * The matrix for a keymap test: every shortcut character (letters, digits,
 * `, . - + ?`) with its strokes on each layout.
 */
export function shortcutKeyMatrix(): Array<{
  key: string
  strokes: KeyStroke[]
}> {
  const keys = [...LETTERS, ...'0123456789'.split(''), ...SHORTCUT_PUNCTUATION]
  return keys.map((key) => ({ key, strokes: strokesFor(key) }))
}

/** Characters that need AltGr on at least one layout (never a shortcut). */
export function altGrCharacters(): string[] {
  const characters = new Set<string>()
  for (const layout of Object.values(KEYBOARD_LAYOUTS)) {
    for (const entry of layout.keys) {
      if (entry.altGr) {
        characters.add(entry.key)
      }
    }
  }
  return [...characters]
}

// ---- Browser helpers ---------------------------------------------------------------

/** A real KeyboardEvent for the stroke (browser only). */
export function toKeyboardEvent(
  stroke: KeyStroke,
  type: 'keydown' | 'keyup' = stroke.type,
): KeyboardEvent {
  return new KeyboardEvent(type, {
    key: stroke.key,
    code: stroke.code,
    ctrlKey: stroke.ctrlKey,
    metaKey: stroke.metaKey,
    altKey: stroke.altKey,
    shiftKey: stroke.shiftKey,
    modifierAltGraph: stroke.altGraph,
    repeat: stroke.repeat,
    isComposing: stroke.isComposing,
    bubbles: true,
    cancelable: true,
    composed: true,
  } as KeyboardEventInit)
}

/**
 * Dispatches keydown then keyup for the stroke on `target` (default: the
 * focused element). Returns false if a listener called preventDefault on
 * the keydown.
 */
export function pressKey(
  stroke: KeyStroke,
  target: EventTarget = document.activeElement ?? document.body,
): boolean {
  const notCancelled = target.dispatchEvent(toKeyboardEvent(stroke, 'keydown'))
  target.dispatchEvent(toKeyboardEvent(stroke, 'keyup'))
  return notCancelled
}

/** A layout as user-event's keyboardMap: `userEvent.setup({ keyboardMap })`. */
export function userEventKeyboardMap(layout: LayoutId): LayoutKey[] {
  return KEYBOARD_LAYOUTS[layout].keys.filter((entry) => entry.key !== 'Dead')
}
