import { describe, expect, it, vi } from 'vitest'
import { createUrlStore } from './history'
import { createMemoryHistory } from './memoryHistory'

function setup(initial = 'https://example.com/wp-upload/?view=library') {
  const env = createMemoryHistory(initial)
  const store = createUrlStore(env)
  const listener = vi.fn()
  store.subscribe(listener)
  return { env, store, listener }
}

describe('URL history policy', () => {
  it('pushes when entering detail', () => {
    const { env, store } = setup()
    store.openItem(7)
    expect(env.entries()).toEqual({
      searches: ['?view=library', '?view=library&item=7'],
      index: 1,
    })
    expect(store.get().item).toBe(7)
    expect(store.isPushedDetail()).toBe(true)
  })

  it('replaces when stepping between items', () => {
    const { env, store } = setup()
    store.openItem(7)
    store.openItem(8)
    store.openItem(9)
    expect(env.entries().searches).toEqual([
      '?view=library',
      '?view=library&item=9',
    ])
    expect(store.isPushedDetail()).toBe(true)
  })

  it('replaces on filter, sort and folder changes (D16)', () => {
    const { env, store } = setup()
    store.navigate({ q: 'beach' })
    store.navigate({ sort: 'title-asc' })
    store.navigate({ folder: 12 })
    expect(env.entries()).toEqual({
      searches: ['?view=library&folder=12&q=beach&sort=title-asc'],
      index: 0,
    })
  })

  it('leaving a pushed detail entry goes back, so Back never re-opens it', () => {
    const { env, store, listener } = setup()
    store.openItem(7)
    store.openItem(8)
    listener.mockClear()
    store.closeItem()
    // The UI closes detail at once, before popstate arrives.
    expect(store.get().item).toBeNull()
    expect(listener).toHaveBeenCalled()
    env.flush()
    expect(env.entries()).toEqual({
      searches: ['?view=library', '?view=library&item=8'],
      index: 0,
    })
    expect(store.get().item).toBeNull()
    expect(store.isPushedDetail()).toBe(false)
  })

  it('leaving detail after a filter change lands on the grid entry with the new filter', () => {
    const { env, store } = setup()
    store.openItem(7)
    store.navigate({ type: 'image' })
    store.closeItem()
    env.flush()
    expect(env.entries()).toEqual({
      searches: ['?view=library&type=image', '?view=library&type=image&item=7'],
      index: 0,
    })
    expect(store.get()).toMatchObject({ type: 'image', item: null })
  })

  it('a deep link replaces when leaving (nothing to go back to)', () => {
    const { env, store } = setup(
      'https://example.com/wp-upload/?view=library&item=3',
    )
    expect(store.get().item).toBe(3)
    expect(store.isPushedDetail()).toBe(false)
    store.closeItem()
    expect(env.entries()).toEqual({ searches: ['?view=library'], index: 0 })
  })

  it('after a reload, leaving a detail entry pushed before it replaces instead of going back', () => {
    const env = createMemoryHistory(
      'https://example.com/wp-upload/?view=library',
    )
    createUrlStore(env, { documentId: 'before-reload' }).openItem(7)
    // The reload keeps history.state (with our marker) but starts a new document.
    const store = createUrlStore(env, { documentId: 'after-reload' })
    const back = vi.spyOn(env.history, 'back')
    expect(store.isPushedDetail()).toBe(false)
    store.closeItem()
    expect(back).not.toHaveBeenCalled()
    expect(env.entries()).toEqual({
      searches: ['?view=library', '?view=library'],
      index: 1,
    })
    expect(store.get().item).toBeNull()
  })

  it('navigations during the pending Back are applied once it lands', () => {
    const { env, store } = setup()
    store.openItem(7)
    store.closeItem()
    store.navigate((current) => ({ density: (current.density + 1) as 3 }))
    expect(store.get()).toMatchObject({ item: null, density: 3 })
    env.flush()
    expect(env.entries().searches[0]).toBe('?view=library&density=3')
    expect(store.get()).toMatchObject({ item: null, density: 3 })
  })

  it('follows the browser Back and Forward buttons', () => {
    const { env, store, listener } = setup()
    store.openItem(7)
    listener.mockClear()
    env.go(-1)
    env.flush()
    expect(store.get().item).toBeNull()
    expect(listener).toHaveBeenCalledTimes(1)
    env.go(1)
    env.flush()
    expect(store.get().item).toBe(7)
    expect(store.isPushedDetail()).toBe(true)
  })

  it('keeps the sub-path, hash and foreign params', () => {
    const { env, store } = setup(
      'https://example.com/some/mount/?view=library&mock-scenario=pro#x',
    )
    store.navigate({ folder: 0 })
    expect(env.location.pathname).toBe('/some/mount/')
    expect(env.location.hash).toBe('#x')
    expect(env.location.search).toBe('?view=library&folder=0&mock-scenario=pro')
  })

  it('is a no-op when nothing changes', () => {
    const { store, listener } = setup()
    store.navigate({ folder: 'all' })
    expect(listener).not.toHaveBeenCalled()
  })

  it('returns a stable snapshot between changes', () => {
    const { store } = setup()
    expect(store.get()).toBe(store.get())
  })

  it('keeps foreign history.state keys on replace', () => {
    const { env, store } = setup()
    env.history.replaceState({ other: 1 }, '', '?view=library')
    store.navigate({ q: 'x' })
    expect(env.history.state).toEqual({ other: 1 })
  })
})
