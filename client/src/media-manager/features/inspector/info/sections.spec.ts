import { describe, expect, it, vi } from 'vitest'
import {
  createSectionStore,
  type KeyValueStorage,
  parseSections,
  SECTION_DEFAULTS,
  SECTIONS_STORAGE_KEY,
} from './sections'

function memoryStorage(): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value)
    },
    removeItem: (key) => {
      data.delete(key)
    },
  }
}

function throwingStorage(): KeyValueStorage {
  const fail = () => {
    throw new Error('SecurityError')
  }
  return { getItem: fail, setItem: fail, removeItem: fail }
}

describe('parseSections', () => {
  it('starts with File and Camera open, Sizes collapsed', () => {
    expect(parseSections(null)).toEqual({
      file: true,
      camera: true,
      sizes: false,
    })
  })

  it('takes stored booleans over the defaults', () => {
    expect(parseSections('{"sizes":true,"file":false}')).toEqual({
      file: false,
      camera: true,
      sizes: true,
    })
  })

  it('ignores malformed values', () => {
    expect(parseSections('not json')).toEqual(SECTION_DEFAULTS)
    expect(parseSections('null')).toEqual(SECTION_DEFAULTS)
    expect(parseSections('[true]')).toEqual(SECTION_DEFAULTS)
    expect(parseSections('{"sizes":"yes","other":true}')).toEqual(
      SECTION_DEFAULTS,
    )
  })
})

describe('createSectionStore', () => {
  it('reads the stored state and writes changes back', () => {
    const storage = memoryStorage()
    storage.setItem(SECTIONS_STORAGE_KEY, '{"camera":false}')
    const store = createSectionStore(() => storage)
    expect(store.get()).toEqual({ file: true, camera: false, sizes: false })

    store.setOpen('sizes', true)
    expect(store.get().sizes).toBe(true)
    expect(JSON.parse(storage.data.get(SECTIONS_STORAGE_KEY) ?? '')).toEqual({
      file: true,
      camera: false,
      sizes: true,
    })

    // A fresh store (a reload) sees the stored state.
    expect(createSectionStore(() => storage).get().sizes).toBe(true)
  })

  it('notifies on changes only', () => {
    const store = createSectionStore(() => memoryStorage())
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)
    store.setOpen('file', true)
    expect(listener).not.toHaveBeenCalled()
    store.setOpen('file', false)
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
    store.setOpen('file', true)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('keeps the state in memory when storage throws', () => {
    const store = createSectionStore(() => throwingStorage())
    expect(store.get()).toEqual(SECTION_DEFAULTS)
    store.setOpen('sizes', true)
    expect(store.get().sizes).toBe(true)
    store.reset()
    expect(store.get()).toEqual(SECTION_DEFAULTS)
  })

  it('works when reaching the storage throws or there is none', () => {
    const blocked = createSectionStore(() => {
      throw new Error('SecurityError')
    })
    blocked.setOpen('camera', false)
    expect(blocked.get().camera).toBe(false)

    const none = createSectionStore(() => null)
    none.setOpen('sizes', true)
    expect(none.get().sizes).toBe(true)
  })

  it('reset() forgets the state, stored copy included', () => {
    const storage = memoryStorage()
    const store = createSectionStore(() => storage)
    store.setOpen('sizes', true)
    store.reset()
    expect(store.get()).toEqual(SECTION_DEFAULTS)
    expect(storage.data.has(SECTIONS_STORAGE_KEY)).toBe(false)
  })
})
