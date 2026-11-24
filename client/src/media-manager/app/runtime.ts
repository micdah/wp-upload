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
import { neighbourOf } from '../core/collection/rows'
import type { Availability } from '../core/commands/registry'
import { implementCommand } from '../core/commands/registry'
import { registerBindings } from '../core/keymap/bindings'
import { DEFAULT_BINDINGS } from '../core/keymap/defaultBindings'
import { installKeymap } from '../core/keymap/dispatch'
import { coreStore, installCoreSync } from '../core/state'
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

/** Opens detail on `id` with the morph from its tile. */
export function openDetail(id: number): Promise<void> {
  return morph(() => urlStore().openItem(id), {
    from: () => centerApi.tileElement(id),
    to: () => centerApi.stageElement(),
  })
}

/**
 * Leaves detail with the morph back into the tile. The tile may be far
 * from where detail was opened, so it is revealed first (spike C2).
 */
export async function closeDetail(): Promise<void> {
  const id = urlStore().get().item
  if (id === null) {
    return
  }
  await morph(() => urlStore().closeItem(), {
    from: () => centerApi.stageElement(),
    to: () => centerApi.revealItem(id),
  })
  centerApi.focusTile(id)
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
  implementCommand('detail.step', {
    available: (args) => {
      const item = url().get().item
      if (item === null) {
        return unavailable('not-in-detail', 'Only in detail mode')
      }
      const rows = settledCollection()?.rows
      if (!rows) {
        return LOADING
      }
      return neighbourOf(rows, item, args.direction) === null
        ? unavailable(
            'at-end',
            args.direction === 1
              ? 'This is the last item'
              : 'This is the first item',
          )
        : OK
    },
    run: (args) => {
      const item = url().get().item
      const rows = settledCollection()?.rows
      const next =
        item === null || !rows ? null : neighbourOf(rows, item, args.direction)
      if (next !== null) {
        url().openItem(next)
      }
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

/**
 * Installs the DOM side of the runtime while the shell is mounted: the
 * keyboard dispatcher, the URL ↔ core-store rules, and browser connectivity.
 * Returns the uninstall function.
 */
export function installRuntime(): () => void {
  const uninstallKeymap = installKeymap({
    getMode: () => (urlStore().get().item === null ? 'grid' : 'detail'),
  })
  const uninstallSync = installCoreSync(urlStore(), coreStore)
  const goOffline = () =>
    coreStore.getState().setConnectivity('offline', 'browser_offline')
  const goOnline = () => {
    if (coreStore.getState().connectivity.reason === 'browser_offline') {
      coreStore.getState().setConnectivity('online')
    }
  }
  window.addEventListener('offline', goOffline)
  window.addEventListener('online', goOnline)
  if (!navigator.onLine) {
    goOffline()
  }
  return () => {
    uninstallKeymap()
    uninstallSync()
    window.removeEventListener('offline', goOffline)
    window.removeEventListener('online', goOnline)
  }
}
