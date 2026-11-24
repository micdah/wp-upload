import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { subscribeAnnouncements } from './announce'
import {
  setToastBackendForTesting,
  type ToastBackend,
  toast,
  undoLast,
} from './toast'
import { createUndoRegistry } from './undoRegistry'

describe('undo registry', () => {
  it('takes the newest entry first, and each entry once', () => {
    const registry = createUndoRegistry()
    registry.push({ key: 'a', label: 'A', run: () => {} })
    registry.push({ key: 'b', label: 'B', run: () => {} })
    expect(registry.takeLast()?.key).toBe('b')
    expect(registry.take('b')).toBeNull()
    expect(registry.take('a')?.key).toBe('a')
    expect(registry.takeLast()).toBeNull()
  })

  it('re-pushing a key moves it to the top', () => {
    const registry = createUndoRegistry()
    registry.push({ key: 'a', label: 'A', run: () => {} })
    registry.push({ key: 'b', label: 'B', run: () => {} })
    registry.push({ key: 'a', label: 'A2', run: () => {} })
    expect(registry.size()).toBe(2)
    expect(registry.takeLast()?.label).toBe('A2')
  })
})

describe('toast() and undoLast()', () => {
  let shown: Map<string, Parameters<ToastBackend['show']>[0]>
  let spoken: string[]
  let unsubscribe: () => void

  beforeEach(() => {
    shown = new Map()
    spoken = []
    setToastBackendForTesting({
      show: (notification) => {
        shown.set(notification.id, notification)
      },
      hide: (id) => {
        const notification = shown.get(id)
        shown.delete(id)
        notification?.onClose()
      },
    })
    unsubscribe = subscribeAnnouncements((message) => spoken.push(message))
  })

  afterEach(() => {
    unsubscribe()
    setToastBackendForTesting(null)
  })

  it('announces every toast once, through the live region', () => {
    toast({ message: 'Saved' })
    expect(spoken).toEqual(['Saved'])
    const notification = [...shown.values()][0]
    expect(notification?.role).toBe('group')
    expect(notification?.autoClose).toBe(4000)
  })

  it('errors stay until closed', () => {
    toast({ message: 'Failed', tone: 'error' })
    expect([...shown.values()][0]?.autoClose).toBe(false)
  })

  it('Ctrl/Cmd+Z undoes the newest undoable toast, once', async () => {
    const first = vi.fn()
    const second = vi.fn()
    toast({ message: 'Moved 3 items', undo: { run: first } })
    toast({ message: 'Plain info' })
    toast({
      message: 'Renamed folder',
      undo: { run: second, done: 'Rename undone' },
    })
    expect(await undoLast()).toBe(true)
    expect(second).toHaveBeenCalledTimes(1)
    expect(first).not.toHaveBeenCalled()
    expect(spoken.at(-1)).toBe('Rename undone')
    expect(await undoLast()).toBe(true)
    expect(first).toHaveBeenCalledTimes(1)
    expect(await undoLast()).toBe(false)
  })

  it('a toast that closed can no longer be undone', async () => {
    const run = vi.fn()
    const handle = toast({ message: 'Moved', undo: { run } })
    handle.close()
    expect(await undoLast()).toBe(false)
    expect(run).not.toHaveBeenCalled()
  })

  it('a failed undo says so', async () => {
    toast({
      message: 'Moved',
      undo: { run: () => Promise.reject(new Error('Network down')) },
    })
    expect(await undoLast()).toBe(false)
    expect(spoken.at(-1)).toBe("Couldn't undo: Network down")
  })
})
