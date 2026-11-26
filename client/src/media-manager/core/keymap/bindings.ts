// Key bindings: which key runs which command, in which mode.
//
// The layout rule (interaction-spec §8, owner rule): shortcuts are matched on
// `event.key` and must be typable natively on US *and* Danish keyboards.
// Allowed: letters, digits, `, . - + ?`, named keys, and Ctrl/Cmd + a letter
// (plus Ctrl/Cmd+Enter, the text-field commit). Forbidden: `[ ] { } \ | @ $ ~`
// and F-keys, which need AltGr on a Danish keyboard or aren't reliable.
// registerBindings() enforces the rule and rejects conflicts at start-up.

import type {
  CommandGroup,
  CommandMap,
  CommandName,
} from '../commands/registry'

/** grid: no item open; detail: `?item=` is set; any: both. */
export type KeyMode = 'grid' | 'detail' | 'any'

interface BindingBase {
  /**
   * `event.key`: a lowercase letter, a digit, one of `, . - + ?`, or a named
   * key such as `ArrowLeft`, `Enter`, `Escape`, ` ` (Space).
   */
  key: string
  /** Ctrl (Windows/Linux) or Cmd (Mac). */
  mod?: boolean
  /** Only for named keys and Mod+letter; for characters Shift is part of the character. */
  shift?: boolean
  mode: KeyMode
  /** The shortcut sheet's label; defaults to the command's label. */
  label?: string
  /** The shortcut sheet's group; defaults to the command's group. */
  group?: CommandGroup
  /** Leave it out of the `?` sheet (e.g. the second of two keys for one action). */
  hidden?: boolean
  /**
   * A folder key: the `?` sheet lists it only while FileBird is active
   * (folders.md §9). Without FileBird the key still answers, with a toast
   * saying folders need the plugin.
   */
  folders?: boolean
  /** Runs again while the key is held (arrows, zoom); otherwise repeats are ignored. */
  repeat?: boolean
}

export type Binding = {
  [K in CommandName]: BindingBase & {
    command: K
  } & (undefined extends CommandMap[K]
      ? { args?: CommandMap[K] }
      : { args: CommandMap[K] })
}[CommandName]

export interface RegisteredBinding extends BindingBase {
  feature: string
  command: CommandName
  args?: unknown
}

/** Named keys a binding may use. */
export const ALLOWED_NAMED_KEYS: ReadonlySet<string> = new Set([
  'Enter',
  'Escape',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  ' ',
  'Tab',
  'Delete',
  'Backspace',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'ContextMenu',
])

const LETTER = /^[a-z]$/
const CHARACTER = /^[a-z0-9,.\-+?]$/

/** Why a binding breaks the layout rule, or null when it is fine. */
export function layoutProblem(
  binding: Pick<BindingBase, 'key' | 'mod' | 'shift'>,
): string | null {
  const { key, mod = false, shift = false } = binding
  const named = ALLOWED_NAMED_KEYS.has(key)
  if (!named && !CHARACTER.test(key)) {
    return `"${key}" is not typable natively on both US and Danish keyboards`
  }
  if (mod && !LETTER.test(key) && key !== 'Enter') {
    return `Ctrl/Cmd is only allowed with a letter or Enter, not "${key}"`
  }
  if (shift && !named && !(mod && LETTER.test(key))) {
    return `Shift is part of the character for "${key}"; bind the character itself`
  }
  return null
}

export function describeBinding(
  binding: Pick<BindingBase, 'key' | 'mod' | 'shift' | 'mode'>,
): string {
  const parts: string[] = []
  if (binding.mod) {
    parts.push('Mod')
  }
  if (binding.shift) {
    parts.push('Shift')
  }
  parts.push(binding.key === ' ' ? 'Space' : binding.key)
  return `${parts.join('+')} (${binding.mode})`
}

function modesOverlap(a: KeyMode, b: KeyMode): boolean {
  return a === 'any' || b === 'any' || a === b
}

function sameChord(a: BindingBase, b: BindingBase): boolean {
  return (
    a.key === b.key &&
    Boolean(a.mod) === Boolean(b.mod) &&
    Boolean(a.shift) === Boolean(b.shift) &&
    modesOverlap(a.mode, b.mode)
  )
}

const registered: RegisteredBinding[] = []
const listeners = new Set<() => void>()

function changed(): void {
  for (const listener of listeners) {
    listener()
  }
}

/**
 * Registers a feature's bindings. Throws when one breaks the layout rule or
 * collides with a binding already registered (same chord, overlapping mode).
 * Returns an unregister function.
 */
export function registerBindings(
  feature: string,
  bindings: readonly Binding[],
): () => void {
  const added: RegisteredBinding[] = []
  for (const binding of bindings) {
    const problem = layoutProblem(binding)
    if (problem) {
      throw new Error(`[keymap] ${feature}: ${binding.command}: ${problem}`)
    }
    const clash = [...registered, ...added].find((other) =>
      sameChord(other, binding),
    )
    if (clash) {
      throw new Error(
        `[keymap] ${feature}: ${describeBinding(binding)} for ${binding.command} conflicts with ${clash.feature}'s ${clash.command}`,
      )
    }
    added.push({ ...binding, feature })
  }
  registered.push(...added)
  changed()
  return () => {
    for (const binding of added) {
      const index = registered.indexOf(binding)
      if (index !== -1) {
        registered.splice(index, 1)
      }
    }
    changed()
  }
}

export function listBindings(): readonly RegisteredBinding[] {
  return registered
}

/**
 * The bindings the `?` sheet lists: not hidden, and the folder keys only
 * while FileBird is active (folders.md §9, A3 CR-5).
 */
export function sheetBindings(options: {
  filebird: boolean
}): RegisteredBinding[] {
  return registered.filter(
    (binding) => !binding.hidden && (options.filebird || !binding.folders),
  )
}

export function bindingsFor(command: CommandName): RegisteredBinding[] {
  return registered.filter((binding) => binding.command === command)
}

export function subscribeBindings(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Throws if any registered binding breaks the layout rule (a start-up self-check). */
export function assertKeymapIsLayoutSafe(
  bindings: readonly BindingBase[] = registered,
): void {
  for (const binding of bindings) {
    const problem = layoutProblem(binding)
    if (problem) {
      throw new Error(`[keymap] ${describeBinding(binding)}: ${problem}`)
    }
  }
}

const KEY_LABELS: Record<string, string> = {
  ' ': 'Space',
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  Escape: 'Esc',
  Delete: 'Delete',
  Backspace: 'Backspace',
  ContextMenu: 'Menu',
}

export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') {
    return false
  }
  return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
}

/** "Ctrl+K" / "⌘K", "Shift+Delete", "?" for display. */
export function formatShortcut(
  binding: Pick<BindingBase, 'key' | 'mod' | 'shift'>,
  mac = isMacPlatform(),
): string {
  const key =
    KEY_LABELS[binding.key] ??
    (binding.key.length === 1 ? binding.key.toUpperCase() : binding.key)
  const parts: string[] = []
  if (binding.mod) {
    parts.push(mac ? '⌘' : 'Ctrl')
  }
  if (binding.shift) {
    parts.push(mac ? '⇧' : 'Shift')
  }
  parts.push(key)
  return mac ? parts.join('') : parts.join('+')
}

/** Tests only. */
export function resetBindingsForTesting(): void {
  registered.splice(0)
  changed()
}
