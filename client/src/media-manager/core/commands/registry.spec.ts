import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  commandAvailability,
  commandInfo,
  implementCommand,
  isImplemented,
  NOT_IMPLEMENTED,
  resetCommandsForTesting,
  runCommand,
  subscribeCommands,
} from './registry'

// A feature adding its own command, as features do in their register().
declare module './registry' {
  interface CommandMap {
    'test.echo': { text: string }
  }
}

afterEach(() => {
  resetCommandsForTesting()
})

describe('command registry', () => {
  it('a declared but unimplemented command is "Not available yet" and never runs', () => {
    expect(isImplemented('folders.create')).toBe(false)
    expect(commandAvailability('folders.create')).toEqual(NOT_IMPLEMENTED)
    expect(runCommand('folders.create')).toBe(false)
    expect(commandInfo('folders.create')).toEqual({
      label: 'New folder',
      group: 'Folders',
    })
  })

  it('runs an implementation with its arguments', () => {
    const run = vi.fn()
    implementCommand('detail.step', { run })
    expect(runCommand('detail.step', { direction: 1 })).toBe(true)
    expect(run).toHaveBeenCalledWith({ direction: 1 })
  })

  it('respects availability', () => {
    const run = vi.fn()
    let ok = false
    implementCommand('panels.toggle-folders', {
      run,
      available: () =>
        ok
          ? { ok: true }
          : { ok: false, code: 'no-filebird', reason: "FileBird isn't active" },
    })
    expect(runCommand('panels.toggle-folders')).toBe(false)
    expect(commandAvailability('panels.toggle-folders')).toMatchObject({
      ok: false,
      code: 'no-filebird',
    })
    ok = true
    expect(runCommand('panels.toggle-folders')).toBe(true)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('refuses a second implementation, and unregisters cleanly', () => {
    const unregister = implementCommand('undo.last', { run: () => {} })
    expect(() => implementCommand('undo.last', { run: () => {} })).toThrow(
      /already implemented/,
    )
    unregister()
    expect(isImplemented('undo.last')).toBe(false)
    expect(() => implementCommand('undo.last', { run: () => {} })).not.toThrow()
  })

  it('supports commands added by module augmentation', () => {
    const run = vi.fn()
    implementCommand('test.echo', { run }, { label: 'Echo', group: 'General' })
    runCommand('test.echo', { text: 'hi' })
    expect(run).toHaveBeenCalledWith({ text: 'hi' })
    expect(commandInfo('test.echo')).toEqual({
      label: 'Echo',
      group: 'General',
    })
  })

  it('notifies subscribers on changes', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeCommands(listener)
    implementCommand('palette.open', { run: () => {} })
    expect(listener).toHaveBeenCalled()
    unsubscribe()
  })

  it('logs a rejected async command instead of throwing', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    implementCommand('items.download', {
      run: () => Promise.reject(new Error('boom')),
    })
    expect(runCommand('items.download')).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })
})
