// toast() and undoLast(): Mantine notifications behind our own API, so
// features never call @mantine/notifications directly.
//
// - Every toast is also announced through the one polite live region (the
//   notification itself gets no live role, so it isn't read twice).
// - A toast with `undo` registers in the undo registry: its Undo button and
//   Ctrl/Cmd+Z (undoLast) both run it, once.

import { Button, Group, Text } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import type { ReactNode } from 'react'
import { notifyCommandsChanged } from '../commands/registry'
import { announce } from './announce'
import { createUndoRegistry } from './undoRegistry'

export type ToastTone = 'info' | 'success' | 'warning' | 'error'

export interface ToastUndo {
  /** Reverts the change. A rejected promise shows "Couldn't undo". */
  run: () => unknown
  /** Shown and announced after a successful undo. Default: "Undone". */
  done?: string
}

export interface ToastAction {
  label: string
  run: () => void
}

export interface ToastOptions {
  message: ReactNode
  /** What the live region says; defaults to `message` when it is a string. */
  announcement?: string
  title?: ReactNode
  tone?: ToastTone
  undo?: ToastUndo
  /** A secondary action, e.g. Retry. */
  action?: ToastAction
  /** Milliseconds, or false to stay until closed. */
  autoClose?: number | false
  /** Reuse an id to replace a toast (e.g. progress updates). */
  id?: string
}

export interface ToastHandle {
  id: string
  close(): void
}

/** The notification calls toast() needs; tests swap in a fake. */
export interface ToastBackend {
  show(notification: {
    id: string
    title?: ReactNode
    message: ReactNode
    color?: string
    autoClose: number | false
    role: string
    onClose: () => void
  }): void
  hide(id: string): void
}

const mantineBackend: ToastBackend = {
  show(base) {
    // Mantine's close button has no accessible name of its own (axe
    // `button-name` whenever a toast is open).
    const notification = {
      ...base,
      closeButtonProps: { 'aria-label': 'Dismiss' },
    }
    // Mantine's show() ignores an id that is already there, so replacing a
    // toast (progress, a new Undo) goes through update(), which in turn
    // ignores an id that isn't there: one of the two takes effect.
    notifications.update(notification)
    notifications.show(notification)
  },
  hide(id) {
    notifications.hide(id)
  },
}

let backend = mantineBackend
// `undo.last` is available while the registry has an entry (canUndo), so
// every change of it calls notifyCommandsChanged() for useCommand().
const registry = createUndoRegistry()
/** What each undoable toast says after a successful undo, by toast id. */
const undoDone = new Map<string, string>()
let sequence = 0

/** Drops a toast's Undo (closed, or replaced by a toast without one). */
function forget(id: string): void {
  registry.remove(id)
  undoDone.delete(id)
  notifyCommandsChanged()
}

export function setToastBackendForTesting(next: ToastBackend | null): void {
  backend = next ?? mantineBackend
}

const DEFAULT_AUTO_CLOSE = 4000
const UNDO_AUTO_CLOSE = 8000

const TONE_COLORS: Record<ToastTone, string | undefined> = {
  info: undefined,
  success: 'teal',
  warning: 'yellow',
  error: 'red',
}

function defaultAutoClose(options: ToastOptions): number | false {
  if (options.autoClose !== undefined) {
    return options.autoClose
  }
  if (options.undo) {
    return UNDO_AUTO_CLOSE
  }
  return options.tone === 'error' ? false : DEFAULT_AUTO_CLOSE
}

function body(id: string, options: ToastOptions): ReactNode {
  if (!options.undo && !options.action) {
    return options.message
  }
  return (
    <Group gap='sm' wrap='nowrap' justify='space-between'>
      <Text size='sm' component='div'>
        {options.message}
      </Text>
      <Group gap={4} wrap='nowrap'>
        {options.action && (
          <Button
            type='button'
            size='compact-sm'
            variant='subtle'
            onClick={() => {
              backend.hide(id)
              options.action?.run()
            }}
          >
            {options.action.label}
          </Button>
        )}
        {options.undo && (
          <Button
            type='button'
            size='compact-sm'
            variant='subtle'
            onClick={() => {
              void runUndo(registry.take(id))
            }}
          >
            Undo
          </Button>
        )}
      </Group>
    </Group>
  )
}

export function toast(options: ToastOptions): ToastHandle {
  sequence += 1
  const id = options.id ?? `mm-toast-${sequence}`
  if (options.undo) {
    const label =
      typeof options.message === 'string' ? options.message : 'Last change'
    registry.push({ key: id, label, run: options.undo.run })
    undoDone.set(id, options.undo.done ?? 'Undone')
    notifyCommandsChanged()
  } else {
    // Replacing an undoable toast with one that isn't: its Undo goes too.
    forget(id)
  }
  backend.show({
    id,
    title: options.title,
    message: body(id, options),
    color: TONE_COLORS[options.tone ?? 'info'],
    autoClose: defaultAutoClose(options),
    // No live role: announce() below is the one place it is spoken.
    role: 'group',
    onClose: () => forget(id),
  })
  const spoken =
    options.announcement ??
    (typeof options.message === 'string' ? options.message : '')
  announce(options.undo && spoken ? `${spoken}. Undo available.` : spoken)
  return {
    id,
    close: () => backend.hide(id),
  }
}

async function runUndo(
  entry: ReturnType<typeof registry.take>,
): Promise<boolean> {
  if (entry === null) {
    return false
  }
  notifyCommandsChanged()
  const done = undoDone.get(entry.key) ?? 'Undone'
  undoDone.delete(entry.key)
  backend.hide(entry.key)
  try {
    await entry.run()
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    toast({ message: `Couldn't undo: ${reason}`, tone: 'error' })
    return false
  }
  toast({ message: done, tone: 'success' })
  return true
}

/** Undoes the newest undoable toast still on screen (Ctrl/Cmd+Z). */
export function undoLast(): Promise<boolean> {
  return runUndo(registry.takeLast())
}

/** Whether any undoable toast is on screen (for the command's availability). */
export function canUndo(): boolean {
  return registry.size() > 0
}
