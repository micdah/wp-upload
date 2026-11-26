import { describe, expect, it } from 'vitest'
import {
  beginSave,
  canRevert,
  displayValue,
  type Entry,
  edit,
  expireSaved,
  hasUnsavedText,
  revert,
  saveFailed,
  saveRefused,
  saveSucceeded,
  statusOf,
} from './autosave'

const CURRENT = 'Old title'

function typed(value: string): Entry {
  return edit(undefined, value, CURRENT)
}

function sending(value: string) {
  const result = beginSave(typed(value), CURRENT)
  if (result.kind !== 'send') {
    throw new Error('expected a send')
  }
  return result
}

describe('autosave state machine', () => {
  it('is clean without an entry and shows the item value', () => {
    expect(statusOf(undefined)).toBeNull()
    expect(displayValue(undefined, CURRENT)).toBe(CURRENT)
    expect(hasUnsavedText(undefined)).toBe(false)
  })

  it('typing makes the field Unsaved and shows the draft', () => {
    const entry = typed('New')
    expect(statusOf(entry)).toBe('unsaved')
    expect(displayValue(entry, CURRENT)).toBe('New')
    expect(hasUnsavedText(entry)).toBe(true)
  })

  it('typing the current value back makes the field clean again', () => {
    expect(edit(typed('New'), CURRENT, CURRENT)).toBeUndefined()
  })

  it('a commit sends the draft and keeps it in the field while saving', () => {
    const result = sending('New')
    expect(result.value).toBe('New')
    expect(statusOf(result.entry)).toBe('saving')
    expect(displayValue(result.entry, CURRENT)).toBe('New')
  })

  it('a commit without changes sends nothing', () => {
    expect(beginSave(undefined, CURRENT)).toEqual({
      kind: 'nothing',
      entry: undefined,
    })
    const unchanged: Entry = {
      draft: CURRENT,
      phase: 'error',
      sending: null,
      queued: false,
      error: 'x',
    }
    expect(beginSave(unchanged, CURRENT)).toEqual({
      kind: 'nothing',
      entry: undefined,
    })
  })

  it('success shows Saved and the item value, then expires to clean', () => {
    const { entry, value } = sending('New')
    const saved = saveSucceeded(entry, value)
    expect(statusOf(saved)).toBe('saved')
    // The cache holds the server's value now.
    expect(displayValue(saved, 'New')).toBe('New')
    expect(expireSaved(saved)).toBeUndefined()
  })

  it('failure keeps the typed text with the error, and Retry sends it again', () => {
    const { entry, value } = sending('New')
    const failed = saveFailed(entry, value, 'WordPress did not respond')
    expect(statusOf(failed)).toBe('error')
    expect(failed?.error).toBe('WordPress did not respond')
    // The cache was rolled back to the old value; the field keeps the text.
    expect(displayValue(failed, CURRENT)).toBe('New')
    expect(hasUnsavedText(failed)).toBe(true)
    const retry = beginSave(failed, CURRENT)
    expect(retry).toMatchObject({ kind: 'send', value: 'New' })
  })

  it('typing while saving is kept, and success then leaves it unsaved', () => {
    const { entry, value } = sending('New')
    const typedOn = edit(entry, 'Newer', 'New')
    expect(statusOf(typedOn)).toBe('saving')
    expect(displayValue(typedOn, 'New')).toBe('Newer')
    const after = saveSucceeded(typedOn, value)
    expect(statusOf(after)).toBe('unsaved')
    expect(displayValue(after, 'New')).toBe('Newer')
  })

  it('a commit while saving is queued for after the save', () => {
    const { entry, value } = sending('New')
    const queued = beginSave(edit(entry, 'Newer', 'New'), 'New')
    expect(queued.kind).toBe('queued')
    expect(queued.entry?.queued).toBe(true)
    const after = saveSucceeded(queued.entry, value)
    expect(after?.queued).toBe(true)
    expect(beginSave(after, 'New')).toMatchObject({
      kind: 'send',
      value: 'Newer',
    })
  })

  it('failure after typing on keeps the newest text', () => {
    const { entry, value } = sending('New')
    const failed = saveFailed(edit(entry, 'Newer', 'New'), value, 'down')
    expect(displayValue(failed, CURRENT)).toBe('Newer')
  })

  it('Esc reverts unsaved text and errors to clean', () => {
    expect(revert(typed('New'))).toBeUndefined()
    const { entry, value } = sending('New')
    expect(revert(saveFailed(entry, value, 'down'))).toBeUndefined()
  })

  it('Esc while saving drops the typing since, back to the text being saved', () => {
    const { entry, value } = sending('New')
    expect(canRevert(entry)).toBe(false)
    const typedOn = beginSave(edit(entry, 'Newer', 'New'), 'New').entry
    expect(canRevert(typedOn)).toBe(true)
    const reverted = revert(typedOn)
    expect(statusOf(reverted)).toBe('saving')
    expect(displayValue(reverted, CURRENT)).toBe('New')
    expect(reverted?.queued).toBe(false)
    expect(canRevert(reverted)).toBe(false)
    // A blur after Esc queues a commit, but the save leaves nothing to send.
    const blurred = beginSave(reverted, 'New')
    expect(blurred.kind).toBe('queued')
    const after = saveSucceeded(blurred.entry, value)
    expect(statusOf(after)).toBe('saved')
    expect(after?.queued).toBe(false)
    // And if the save fails, the field keeps the text that was sent.
    expect(displayValue(saveFailed(blurred.entry, value, 'x'), CURRENT)).toBe(
      'New',
    )
  })

  it('Esc can revert unsaved text and errors, not a clean or Saved field', () => {
    expect(canRevert(typed('New'))).toBe(true)
    const { entry, value } = sending('New')
    expect(canRevert(saveFailed(entry, value, 'down'))).toBe(true)
    expect(canRevert(saveSucceeded(entry, value))).toBe(false)
    expect(canRevert(undefined)).toBe(false)
  })

  it('a commit right after a save keeps ✓ Saved', () => {
    const { entry, value } = sending('New')
    const saved = saveSucceeded(entry, value)
    const blurred = beginSave(saved, 'New')
    expect(blurred.kind).toBe('nothing')
    expect(blurred.entry).toBe(saved)
  })

  it('a refused commit shows the reason and keeps the text', () => {
    const refused = saveRefused(typed('New'), 'WordPress is unreachable')
    expect(statusOf(refused)).toBe('error')
    expect(refused?.error).toBe('WordPress is unreachable')
    expect(displayValue(refused, CURRENT)).toBe('New')
    expect(saveRefused(undefined, 'x')).toBeUndefined()
  })

  it('only a Saved entry expires', () => {
    const entry = typed('New')
    expect(expireSaved(entry)).toBe(entry)
  })
})
