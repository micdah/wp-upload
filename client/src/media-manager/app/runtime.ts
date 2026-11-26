// The app runtime: the commands core implements itself, the default keymap,
// and the DOM wiring (keyboard dispatcher, URL ↔ store sync, connectivity).
//
// Core implements the commands that only touch core state or the URL:
// selection, detail open/close/step (with the morph), zoom, density and
// layout, panels, undo. Feature commands (grid.move-focus, peek.toggle,
// folders.*, upload.pick, items.*, help.shortcuts, palette.open, …) are
// implemented by their features' register().

import { centerApi } from '../core/collection/centerApi'
import {
  type CollectionView,
  getCurrentCollection,
} from '../core/collection/hooks'
import {
  type DetailPosition,
  queryKeyOf,
  stepFrom,
} from '../core/collection/rows'
import type { Availability } from '../core/commands/registry'
import { implementCommand, subscribeCommands } from '../core/commands/registry'
import {
  type ConnectivityStore,
  connectivityStore,
} from '../core/data/connectivity'
import { registerBindings } from '../core/keymap/bindings'
import { DEFAULT_BINDINGS } from '../core/keymap/defaultBindings'
import { installKeymap } from '../core/keymap/dispatch'
import { type CoreStore, coreStore, installCoreSync } from '../core/state'
import { announce, plural } from '../core/ui/announce'
import { morph } from '../core/ui/morph'
import { canUndo, undoLast } from '../core/ui/toast'
import { MAX_DENSITY } from '../core/url/codec'
import { urlStore } from '../core/url/useUrlState'

const OK: Availability = { ok: true }

function unavailable(code: string, reason: string): Availability {
  return { ok: false, code, reason }
}

function inDetail(): Availability {
  return urlStore().get().item === null
    ? unavailable('not-in-detail', 'Only in detail mode')
    : OK
}

function hasFileBird(): Availability {
  const filebird = coreStore.getState().bootstrap?.site?.filebird
  return filebird?.active
    ? OK
    : unavailable('no-filebird', "FileBird isn't active")
}

/**
 * The collection on screen, or null while it isn't settled. With
 * keepPreviousData the grid keeps showing the previous folder's rows while
 * a new query loads (`isPlaceholder`); acting on those (select all, ←/→ in
 * detail) would act on the wrong folder.
 */
function settledCollection(): CollectionView | null {
  const collection = getCurrentCollection()
  if (
    !collection ||
    collection.isPlaceholder ||
    collection.status !== 'success'
  ) {
    return null
  }
  return collection
}

const LOADING = unavailable('loading', 'Still loading')

function announceSelection(): void {
  const count = coreStore.getState().selection.size
  announce(
    count === 0 ? 'Selection cleared' : `${plural(count, 'item')} selected`,
  )
}

/**
 * Opens detail on `id` with the morph from its tile's picture. The grid
 * names it only while the tile is fully in view (spike C2); otherwise the
 * morph runs without a hero.
 */
export function openDetail(id: number): Promise<void> {
  // Keyboard focus leaves the tile before the grid turns inert, rather than
  // being dropped by the browser mid-transition; detail focuses itself.
  const active = document.activeElement
  if (
    active instanceof HTMLElement &&
    active.closest('[data-mm-grid-scroll]')
  ) {
    active.blur()
  }
  return morph(() => urlStore().openItem(id), {
    from: () => centerApi.heroElement(id),
    to: () => centerApi.stageElement(),
  })
}

/**
 * Leaves detail with the morph back into the tile. The tile may be far
 * from where detail was opened, so it is revealed first (spike C2), and
 * then its picture is the morph's target.
 */
export async function closeDetail(): Promise<void> {
  const id = urlStore().get().item
  if (id === null) {
    return
  }
  await morph(() => urlStore().closeItem(), {
    from: () => centerApi.stageElement(),
    // Only the hero the grid names (fully in view); otherwise no hero,
    // never a half-hidden tile (spike C2).
    to: async () => {
      await centerApi.revealItem(id)
      return centerApi.heroElement(id)
    },
  })
  centerApi.focusTile(id)
}

/**
 * The end of the collection in a direction, for the announcement when
 * detail stepping stops there (D34: no wrap-around).
 */
function edgeMessage(direction: 1 | -1): string {
  return direction === 1 ? 'Last item in this view' : 'First item in this view'
}

/** Where detail last saw its item in the collection (detail.step). */
let detailPosition: DetailPosition | null = null

function rememberDetailPosition(collection: CollectionView, id: number): void {
  const index = collection.rows.indexOf(id)
  if (index >= 0) {
    detailPosition = { id, index, query: queryKeyOf(collection.query) }
  }
}

function stepOf(collection: CollectionView, id: number, direction: 1 | -1) {
  return stepFrom(
    collection.rows,
    id,
    direction,
    detailPosition,
    queryKeyOf(collection.query),
  )
}

let commandsRegistered = false

/** Registers core's commands and the default keymap. Idempotent. */
export function registerCoreCommands(): void {
  if (commandsRegistered) {
    return
  }
  commandsRegistered = true
  const store = () => coreStore.getState()
  const url = () => urlStore()

  implementCommand('selection.clear', {
    run: () => {
      const hadSelection = store().selection.size > 0
      store().clearSelection()
      if (hadSelection) {
        announceSelection()
      }
    },
  })
  implementCommand('selection.toggle-focused', {
    available: () =>
      store().focus === null
        ? unavailable('no-focus', 'Nothing is focused')
        : OK,
    run: () => {
      const focus = store().focus
      if (focus !== null) {
        store().toggleSelected(focus)
        announceSelection()
      }
    },
  })
  implementCommand('selection.select-all', {
    available: () => {
      const collection = settledCollection()
      if (!collection) {
        return LOADING
      }
      return collection.total > 0
        ? OK
        : unavailable('empty', 'Nothing to select')
    },
    run: () => {
      const collection = settledCollection()
      if (collection) {
        store().selectAll(collection.ids)
        announce(`All ${plural(collection.ids.length, 'item')} selected`)
      }
    },
  })

  implementCommand('detail.open', {
    available: (args) => {
      const id = args?.id ?? store().focus
      return id === null ? unavailable('no-focus', 'Nothing is focused') : OK
    },
    run: (args) => {
      const id = args?.id ?? store().focus
      if (id !== null) {
        return openDetail(id)
      }
    },
  })
  implementCommand('detail.close', {
    available: inDetail,
    run: () => closeDetail(),
  })
  // Stepping stops at both ends (D34). The command stays available there, so
  // ←/→ at an end still reach it: it nudges the stage and announces the end
  // instead of doing nothing. The stage's own buttons disable themselves.
  //
  // An item that leaves the view while shown (Missing alt filter, alt
  // saved) steps from the place it had; a deep link the filters hide has
  // nowhere to step.
  implementCommand('detail.step', {
    available: (args) => {
      const item = url().get().item
      if (item === null) {
        return unavailable('not-in-detail', 'Only in detail mode')
      }
      const collection = settledCollection()
      if (!collection) {
        return LOADING
      }
      rememberDetailPosition(collection, item)
      return stepOf(collection, item, args.direction)
        ? OK
        : unavailable('not-in-view', 'This item is not in the current view')
    },
    run: (args) => {
      const item = url().get().item
      const collection = settledCollection()
      if (item === null || !collection) {
        return
      }
      rememberDetailPosition(collection, item)
      const step = stepOf(collection, item, args.direction)
      if (!step) {
        return
      }
      if ('edge' in step) {
        centerApi.nudgeStage(args.direction)
        announce(edgeMessage(args.direction))
        return
      }
      url().openItem(step.next)
    },
  })
  implementCommand('detail.zoom-toggle', {
    available: inDetail,
    run: () => store().setZoom(store().zoom === 'fit' ? 1 : 'fit'),
  })
  implementCommand('detail.zoom-step', {
    available: inDetail,
    run: (args) => store().stepZoom(args.direction),
  })

  implementCommand('grid.density-step', {
    run: (args) =>
      url().navigate((current) => ({
        density: Math.min(
          MAX_DENSITY,
          Math.max(0, current.density + args.direction),
        ) as 0 | 1 | 2 | 3 | 4,
      })),
  })
  implementCommand('grid.layout-toggle', {
    run: () =>
      url().navigate((current) => ({
        layout: current.layout === 'justified' ? 'square' : 'justified',
      })),
  })

  implementCommand('panels.toggle-folders', {
    available: hasFileBird,
    run: () => store().toggleFolders(),
  })
  implementCommand('panels.toggle-inspector', {
    run: () => store().toggleInspector(),
  })
  implementCommand('inspector.open-tab', {
    run: (args) => store().selectInspectorTab(args.tab),
  })

  implementCommand('undo.last', {
    available: () =>
      canUndo() ? OK : unavailable('nothing-to-undo', 'Nothing to undo'),
    run: () => undoLast(),
  })

  registerBindings('core', DEFAULT_BINDINGS)
}

/** The browser's side of connectivity, injectable for tests. */
export interface BrowserNetwork {
  isOnline(): boolean
  addEventListener(type: 'online' | 'offline', listener: () => void): void
  removeEventListener(type: 'online' | 'offline', listener: () => void): void
}

const browserNetwork: BrowserNetwork = {
  isOnline: () => navigator.onLine,
  addEventListener: (type, listener) => window.addEventListener(type, listener),
  removeEventListener: (type, listener) =>
    window.removeEventListener(type, listener),
}

/**
 * Keeps the core store's `connectivity` (what can(), the banners and
 * commands read) in step with the data layer's connectivity store (the one
 * source: it sees every library request) and the browser's own online flag.
 * `wp-auth-failed` counts as offline with reason `wp_auth_failed`, so can()
 * denies mutations while WordPress rejects the app password. Returns the
 * uninstall function.
 */
export function installConnectivityMirror(
  data: ConnectivityStore = connectivityStore,
  core: { getState(): Pick<CoreStore, 'setConnectivity'> } = coreStore,
  network: BrowserNetwork = browserNetwork,
): () => void {
  const sync = () => {
    const snapshot = data.getSnapshot()
    const set = core.getState().setConnectivity
    if (!network.isOnline()) {
      set('offline', 'browser_offline')
    } else if (snapshot.state === 'wp-auth-failed') {
      set('offline', 'wp_auth_failed')
    } else if (snapshot.state === 'offline') {
      set('offline', snapshot.lastError?.code ?? 'wp_unreachable')
    } else {
      set('online')
    }
  }
  sync()
  const unsubscribe = data.subscribe(sync)
  network.addEventListener('offline', sync)
  network.addEventListener('online', sync)
  return () => {
    unsubscribe()
    network.removeEventListener('offline', sync)
    network.removeEventListener('online', sync)
  }
}

/**
 * Installs the DOM side of the runtime while the shell is mounted: the
 * keyboard dispatcher, the URL ↔ core-store rules, and connectivity.
 * Returns the uninstall function.
 */
export function installRuntime(): () => void {
  const uninstallKeymap = installKeymap({
    getMode: () => (urlStore().get().item === null ? 'grid' : 'detail'),
  })
  const uninstallSync = installCoreSync(urlStore(), coreStore)
  const uninstallConnectivity = installConnectivityMirror()
  // Keep detail's position current, so an item that leaves the view while
  // shown still steps from its place.
  const remember = () => {
    const item = urlStore().get().item
    const collection = settledCollection()
    if (item !== null && collection) {
      rememberDetailPosition(collection, item)
    }
  }
  const unsubscribeUrl = urlStore().subscribe(remember)
  const unsubscribeCommands = subscribeCommands(remember)
  remember()
  return () => {
    uninstallKeymap()
    uninstallSync()
    uninstallConnectivity()
    unsubscribeUrl()
    unsubscribeCommands()
  }
}
