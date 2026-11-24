// The command registry (plan §4 "Foundation APIs").
//
// - CommandMap declares every cross-feature command up front, with its
//   argument type (`undefined` = none). Features add their own commands through
//   module augmentation:
//
//       declare module '../../core/commands/registry' {
//         interface CommandMap { 'folders.expand-all': void }
//       }
//
// - The owning feature implements a command with implementCommand(), usually
//   in its register(). Everything else runs it by name (keymap, palette,
//   menus, buttons) through runCommand() or useCommand().
// - A declared command nobody implements yet is "Not available yet": it
//   renders disabled and never runs.

import type { InspectorTab } from '../state/store'

export type MoveDirection = 'left' | 'right' | 'up' | 'down' | 'first' | 'last'

/** The commands core declares up front (labels below). */
export interface CoreCommandMap {
  // Navigate and select (grid)
  'grid.move-focus': {
    to: MoveDirection
    mode?: 'select' | 'extend' | 'focus-only'
  }
  'selection.toggle-focused': undefined
  'selection.select-all': undefined
  'selection.clear': undefined
  // View
  'detail.open': { id?: number } | undefined
  'detail.close': undefined
  'detail.step': { direction: 1 | -1 }
  'detail.zoom-toggle': undefined
  'detail.zoom-step': { direction: 1 | -1 }
  'peek.toggle': undefined
  'grid.density-step': { direction: 1 | -1 }
  'grid.layout-toggle': undefined
  // Panels
  'panels.toggle-folders': undefined
  'panels.toggle-inspector': undefined
  'inspector.open-tab': { tab: InspectorTab }
  // Edit
  'inspector.edit-image': undefined
  'inspector.focus-alt': undefined
  // Folders
  'folders.create': undefined
  'folders.rename': undefined
  'folders.move-to': undefined
  'folders.context-menu': undefined
  // Files
  'upload.pick': undefined
  /** `Delete`: remove from the folder in a folder, otherwise delete. */
  'items.delete': { fromLibrary?: boolean } | undefined
  'items.download': undefined
  // General
  'help.shortcuts': undefined
  'palette.open': undefined
  'undo.last': undefined
  'theme.toggle': undefined
  'session.logout': undefined
}

/**
 * Every command and its argument (undefined = none): the core declarations plus
 * whatever features add by augmenting this interface.
 */
export interface CommandMap extends CoreCommandMap {}

export type CommandName = keyof CommandMap

/** The arguments `runCommand` takes for a command: none, optional or one. */
export type CommandArgs<K extends CommandName> = undefined extends CommandMap[K]
  ? [args?: CommandMap[K]]
  : CommandMap[K] extends void
    ? []
    : [args: CommandMap[K]]

/** Same shape as can(): ok, or a code plus a sentence for tooltips. */
export type Availability =
  | { ok: true }
  | { ok: false; code: string; reason: string }

export const AVAILABLE: Availability = Object.freeze({ ok: true })
export const NOT_IMPLEMENTED: Availability = Object.freeze({
  ok: false,
  code: 'not-implemented',
  reason: 'Not available yet',
})

export interface CommandImpl<K extends CommandName> {
  run(args: CommandMap[K]): unknown
  /**
   * Whether it can run now. Called during render and before every run, so
   * keep it cheap and synchronous. Read state with getState(), not hooks.
   */
  available?(args: CommandMap[K]): Availability
}

export const COMMAND_GROUPS = [
  'Navigate',
  'Select',
  'View',
  'Panels',
  'Edit',
  'Folders',
  'Files',
  'General',
] as const
export type CommandGroup = (typeof COMMAND_GROUPS)[number]

export interface CommandInfo {
  label: string
  group: CommandGroup
}

/** Labels for the palette and the shortcut sheet, before anyone implements. */
const DECLARED: { [K in keyof CoreCommandMap]: CommandInfo } = {
  'grid.move-focus': { label: 'Move focus', group: 'Navigate' },
  'selection.toggle-focused': { label: 'Toggle selection', group: 'Select' },
  'selection.select-all': { label: 'Select all', group: 'Select' },
  'selection.clear': { label: 'Clear selection', group: 'Select' },
  'detail.open': { label: 'Open in detail mode', group: 'View' },
  'detail.close': { label: 'Back to grid', group: 'View' },
  'detail.step': { label: 'Previous / next item', group: 'Navigate' },
  'detail.zoom-toggle': { label: 'Zoom: fit / 100 %', group: 'View' },
  'detail.zoom-step': { label: 'Zoom in / out', group: 'View' },
  'peek.toggle': { label: 'Quick peek', group: 'View' },
  'grid.density-step': { label: 'Larger / smaller thumbnails', group: 'View' },
  'grid.layout-toggle': { label: 'Justified / square layout', group: 'View' },
  'panels.toggle-folders': { label: 'Toggle folder column', group: 'Panels' },
  'panels.toggle-inspector': { label: 'Toggle inspector', group: 'Panels' },
  'inspector.open-tab': { label: 'Open inspector tab', group: 'Panels' },
  'inspector.edit-image': { label: 'Edit image', group: 'Edit' },
  'inspector.focus-alt': { label: 'Jump to alt text', group: 'Edit' },
  'folders.create': { label: 'New folder', group: 'Folders' },
  'folders.rename': { label: 'Rename folder', group: 'Folders' },
  'folders.move-to': { label: 'Move to folder…', group: 'Folders' },
  'folders.context-menu': { label: 'Folder menu', group: 'Folders' },
  'upload.pick': { label: 'Upload files', group: 'Files' },
  'items.delete': { label: 'Delete', group: 'Files' },
  'items.download': { label: 'Download', group: 'Files' },
  'help.shortcuts': { label: 'Keyboard shortcuts', group: 'General' },
  'palette.open': { label: 'Command palette', group: 'General' },
  'undo.last': { label: 'Undo the last change', group: 'General' },
  'theme.toggle': { label: 'Toggle light / dark theme', group: 'General' },
  'session.logout': { label: 'Log out', group: 'General' },
}

type AnyImpl = CommandImpl<CommandName>

const implementations = new Map<CommandName, AnyImpl>()
const infos = new Map<CommandName, CommandInfo>(
  Object.entries(DECLARED) as [CommandName, CommandInfo][],
)
const listeners = new Set<() => void>()
let version = 0

function changed(): void {
  version += 1
  for (const listener of listeners) {
    listener()
  }
}

/**
 * Implements a command. Throws when another implementation is registered,
 * so two features can't silently fight over one command. Returns an
 * unregister function (for tests and hot reload).
 */
export function implementCommand<K extends CommandName>(
  name: K,
  impl: CommandImpl<K>,
  info?: CommandInfo,
): () => void {
  if (implementations.has(name)) {
    throw new Error(`Command "${name}" is already implemented`)
  }
  implementations.set(name, impl as unknown as AnyImpl)
  if (info) {
    infos.set(name, info)
  }
  changed()
  return () => {
    if (implementations.get(name) === (impl as unknown as AnyImpl)) {
      implementations.delete(name)
      changed()
    }
  }
}

/** Labels a command added by module augmentation (palette, sheet). */
export function describeCommand(name: CommandName, info: CommandInfo): void {
  infos.set(name, info)
  changed()
}

export function commandInfo(name: CommandName): CommandInfo {
  return infos.get(name) ?? { label: name, group: 'General' }
}

export function listCommands(): CommandName[] {
  return [...infos.keys()]
}

export function isImplemented(name: CommandName): boolean {
  return implementations.has(name)
}

export function commandAvailability<K extends CommandName>(
  name: K,
  ...args: CommandArgs<K>
): Availability {
  const impl = implementations.get(name)
  if (!impl) {
    return NOT_IMPLEMENTED
  }
  if (!impl.available) {
    return AVAILABLE
  }
  return impl.available(args[0] as CommandMap[CommandName])
}

/**
 * Runs a command if it is implemented and available. Returns whether it ran.
 * The implementation's result (e.g. a promise) is not awaited.
 */
export function runCommand<K extends CommandName>(
  name: K,
  ...args: CommandArgs<K>
): boolean {
  const impl = implementations.get(name)
  if (!impl) {
    return false
  }
  const arg = args[0] as CommandMap[CommandName]
  if (impl.available && !impl.available(arg).ok) {
    return false
  }
  const result = impl.run(arg)
  if (result instanceof Promise) {
    result.catch((error: unknown) => {
      console.error(`Command "${name}" failed`, error)
    })
  }
  return true
}

/** Subscribe to registry changes (implement/unregister/describe). */
export function subscribeCommands(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Tells useCommand() to re-check availability. Call it when feature-local
 * state that an `available()` reads has changed (core store and URL changes
 * are watched already).
 */
export function notifyCommandsChanged(): void {
  changed()
}

export function commandsVersion(): number {
  return version
}

/** Tests only: drop every implementation and custom description. */
export function resetCommandsForTesting(): void {
  implementations.clear()
  infos.clear()
  for (const [name, info] of Object.entries(DECLARED)) {
    infos.set(name as CommandName, info)
  }
  changed()
}
