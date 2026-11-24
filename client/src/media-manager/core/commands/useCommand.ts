// useCommand(): what a button, menu item or palette row needs to show and
// run a command: { run, enabled, reason, shortcut, label }. It re-renders
// when availability can change: the registry, the core store, the URL, the
// keymap, or notifyCommandsChanged().

import { useCallback, useRef, useSyncExternalStore } from 'react'
import {
  bindingsFor,
  formatShortcut,
  subscribeBindings,
} from '../keymap/bindings'
import { coreStore } from '../state'
import { urlStore } from '../url/useUrlState'
import {
  type CommandArgs,
  type CommandName,
  commandAvailability,
  commandInfo,
  runCommand,
  subscribeCommands,
} from './registry'

export interface CommandState {
  /** Runs it if available; returns whether it ran. */
  run(): boolean
  enabled: boolean
  /** Why it is disabled (for the tooltip), or null. */
  reason: string | null
  code: string | null
  /** The first visible binding, formatted ("Ctrl+K", "⌘K", "F"), or null. */
  shortcut: string | null
  label: string
}

/** The first non-hidden binding of a command, formatted for display. */
export function shortcutFor(name: CommandName): string | null {
  const bindings = bindingsFor(name)
  const binding = bindings.find((candidate) => !candidate.hidden) ?? bindings[0]
  return binding ? formatShortcut(binding) : null
}

function subscribeAll(listener: () => void): () => void {
  const unsubscribers = [
    subscribeCommands(listener),
    subscribeBindings(listener),
    coreStore.subscribe(listener),
    urlStore().subscribe(listener),
  ]
  return () => {
    for (const unsubscribe of unsubscribers) {
      unsubscribe()
    }
  }
}

interface Snapshot {
  key: string
  enabled: boolean
  reason: string | null
  code: string | null
  shortcut: string | null
  label: string
}

export function useCommand<K extends CommandName>(
  name: K,
  ...args: CommandArgs<K>
): CommandState {
  const argsKey = JSON.stringify(args[0] ?? null)
  const argsRef = useRef(args)
  argsRef.current = args
  const cache = useRef<Snapshot | null>(null)

  const getSnapshot = useCallback((): Snapshot => {
    const availability = commandAvailability(name, ...argsRef.current)
    const shortcut = shortcutFor(name)
    const { label } = commandInfo(name)
    const reason = availability.ok ? null : availability.reason
    const code = availability.ok ? null : availability.code
    const key = `${availability.ok}|${code}|${reason}|${shortcut}|${label}|${argsKey}`
    if (cache.current?.key !== key) {
      cache.current = {
        key,
        enabled: availability.ok,
        reason,
        code,
        shortcut,
        label,
      }
    }
    return cache.current
  }, [name, argsKey])

  const snapshot = useSyncExternalStore(subscribeAll, getSnapshot, getSnapshot)
  const run = useCallback(() => runCommand(name, ...argsRef.current), [name])
  return {
    run,
    enabled: snapshot.enabled,
    reason: snapshot.reason,
    code: snapshot.code,
    shortcut: snapshot.shortcut,
    label: snapshot.label,
  }
}
