import { describe, expect, it } from 'vitest'
import { createUrlStore } from '../url/history'
import { createMemoryHistory } from '../url/memoryHistory'
import {
  createCoreStore,
  isFoldersOpen,
  isInspectorOpen,
  PANELS_STORAGE_KEY,
} from './store'
import { installCoreSync } from './sync'

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value)
    },
    removeItem: (key: string) => {
      data.delete(key)
    },
  }
}

describe('core store', () => {
  it('persists panels only, and sanitises what it reads back', () => {
    const storage = memoryStorage({
      [PANELS_STORAGE_KEY]: JSON.stringify({
        state: {
          panels: {
            foldersOpen: false,
            folderWidth: 9999,
            inspectorTab: 'bogus',
          },
        },
        version: 1,
      }),
    })
    const store = createCoreStore({ storage })
    expect(store.getState().panels).toEqual({
      foldersOpen: false,
      folderWidth: 480,
      inspectorOpen: true,
      inspectorTab: 'info',
    })
    store.getState().selectOnly(5)
    store.getState().setFolderWidth(100)
    const saved = JSON.parse(storage.data.get(PANELS_STORAGE_KEY) ?? '{}')
    expect(saved.state).toEqual({
      panels: {
        foldersOpen: false,
        folderWidth: 220,
        inspectorOpen: true,
        inspectorTab: 'info',
      },
    })
  })

  it('keeps the wide inspector preference separate from narrow viewports', () => {
    const store = createCoreStore({ storage: null })
    const actions = store.getState()
    expect(isInspectorOpen(store.getState())).toBe(true)
    actions.setViewport('medium')
    // 900–1199 px: the inspector starts collapsed.
    expect(isInspectorOpen(store.getState())).toBe(false)
    actions.toggleInspector()
    expect(isInspectorOpen(store.getState())).toBe(true)
    actions.setViewport('wide')
    expect(store.getState().panels.inspectorOpen).toBe(true)
    actions.toggleInspector()
    expect(store.getState().panels.inspectorOpen).toBe(false)
  })

  it('the folder drawer below 900 px starts closed and leaves the column preference alone', () => {
    const store = createCoreStore({ storage: null })
    const actions = store.getState()
    expect(isFoldersOpen(store.getState())).toBe(true)
    actions.setViewport('narrow')
    expect(isFoldersOpen(store.getState())).toBe(false)
    actions.toggleFolders()
    expect(store.getState()).toMatchObject({
      compactFoldersOpen: true,
      panels: { foldersOpen: true },
    })
    actions.setViewport('medium')
    actions.toggleFolders()
    expect(store.getState().panels.foldersOpen).toBe(false)
  })

  it('rail click opens a tab, or collapses when it is the open one', () => {
    const store = createCoreStore({ storage: null })
    const actions = store.getState()
    actions.selectInspectorTab('usage')
    expect(store.getState().panels).toMatchObject({
      inspectorTab: 'usage',
      inspectorOpen: true,
    })
    actions.selectInspectorTab('usage')
    expect(store.getState().panels.inspectorOpen).toBe(false)
    actions.selectInspectorTab('usage')
    expect(store.getState().panels.inspectorOpen).toBe(true)
  })

  it('steps zoom within Fit, 50, 100, 200 %', () => {
    const store = createCoreStore({ storage: null })
    const actions = store.getState()
    actions.stepZoom(-1)
    expect(store.getState().zoom).toBe('fit')
    actions.stepZoom(1)
    actions.stepZoom(1)
    actions.stepZoom(1)
    actions.stepZoom(1)
    expect(store.getState().zoom).toBe(2)
  })

  it('records when connectivity was lost', () => {
    const store = createCoreStore({ storage: null })
    store.getState().setConnectivity('offline', 'wp_unreachable')
    const since = store.getState().connectivity.since
    expect(since).toBeTypeOf('number')
    store.getState().setConnectivity('offline', 'wp_timeout')
    expect(store.getState().connectivity).toEqual({
      state: 'offline',
      since,
      reason: 'wp_timeout',
    })
    store.getState().setConnectivity('online')
    expect(store.getState().connectivity).toEqual({
      state: 'online',
      since: null,
      reason: null,
    })
  })
})

describe('URL ↔ core sync', () => {
  function setup() {
    const env = createMemoryHistory('https://example.com/?view=library')
    const url = createUrlStore(env)
    const core = createCoreStore({ storage: null })
    installCoreSync(url, core)
    return { env, url, core }
  }

  it('a folder change clears selection and focus, a filter change keeps them', () => {
    const { url, core } = setup()
    core.getState().selectAll([1, 2, 3])
    core.getState().setFocus(2)
    url.navigate({ type: 'image' })
    expect(core.getState().selection.size).toBe(3)
    url.navigate({ folder: 4 })
    expect(core.getState()).toMatchObject({ anchor: null, focus: null })
    expect(core.getState().selection.size).toBe(0)
  })

  it('also on Back across a folder change', () => {
    const { env, url, core } = setup()
    url.navigate({ folder: 4 })
    url.openItem(9)
    core.getState().selectOnly(9)
    env.go(-1)
    env.flush()
    expect(core.getState().selection.size).toBe(1)
  })

  it('a deep link focuses and selects its item (D52)', () => {
    const env = createMemoryHistory('https://example.com/?view=library&item=42')
    const core = createCoreStore({ storage: null })
    installCoreSync(createUrlStore(env), core)
    expect(core.getState().focus).toBe(42)
    expect([...core.getState().selection]).toEqual([42])
  })

  it('stepping moves a single selection along; leaving keeps it (D52)', () => {
    const { env, url, core } = setup()
    core.getState().selectOnly(3)
    url.openItem(3)
    url.openItem(4)
    url.openItem(5)
    expect(core.getState()).toMatchObject({ anchor: 5, focus: 5 })
    expect([...core.getState().selection]).toEqual([5])
    env.go(-1)
    env.flush()
    expect(url.get().item).toBeNull()
    expect([...core.getState().selection]).toEqual([5])
    expect(core.getState().focus).toBe(5)
  })

  it('stepping keeps a selection of two or more, moving only the focus (D52)', () => {
    const { url, core } = setup()
    core.getState().selectAll([1, 2, 3])
    core.getState().setFocus(3)
    url.openItem(3)
    url.openItem(4)
    expect([...core.getState().selection]).toEqual([1, 2, 3])
    expect(core.getState().focus).toBe(4)
  })

  it('detail moves focus to the item, resets zoom and closes overlays', () => {
    const { url, core } = setup()
    core.getState().openOverlay('peek')
    core.getState().setZoom(2)
    url.openItem(7)
    expect(core.getState()).toMatchObject({
      focus: 7,
      zoom: 'fit',
      overlay: null,
    })
    core.getState().setZoom(1)
    url.openItem(8)
    expect(core.getState()).toMatchObject({ focus: 8, zoom: 'fit' })
  })
})
