// The `folders` feature (track A3): the FileBird folder column, drag and drop
// to folders, Move to… and the folder commands (folders.md, interaction-spec
// §6–§7).
//
// The shell renders <FolderColumn/> inside its folder <aside> whenever
// FileBird is active, and calls register() once at start-up.
//
// This entry is in the initial chunk (plan §9, D31), so it stays thin: the
// commands and a wrapper that lazily loads the column. Everything else (the
// tree, menus, the Move dialog, drag and drop, the operations in
// actions.tsx) is a lazy chunk, fetched as soon as the column mounts. A
// command that runs before then loads it on demand.

import { useQueryClient } from '@tanstack/react-query'
import { lazy, Suspense, useEffect } from 'react'
import {
  type Availability,
  implementCommand,
} from '../../core/commands/registry'
import { onSessionReset } from '../../core/state'
import { urlStore } from '../../core/url/useUrlState'
import { bindFolderQueryClient } from './runtime'

declare module '../../core/commands/registry' {
  interface CommandMap {
    /** `Delete` inside a folder: the targets go to Uncategorized (system.md §2). */
    'folders.remove-from-folder': undefined
    'folders.expand-all': undefined
    'folders.collapse-all': undefined
  }
}

const loadColumn = () => import('./Column')
const loadActions = () => import('./actions')

const LazyColumn = lazy(() =>
  loadColumn().then((module) => ({ default: module.Column })),
)

export function FolderColumn() {
  const queryClient = useQueryClient()
  useEffect(() => {
    bindFolderQueryClient(queryClient)
    return () => bindFolderQueryClient(null)
  }, [queryClient])
  return (
    <Suspense fallback={null}>
      <LazyColumn />
    </Suspense>
  )
}

const OK: Availability = { ok: true }

/** The folder being viewed, when it is a real FileBird folder. */
function viewedFolder(): number | null {
  const folder = urlStore().get().folder
  return typeof folder === 'number' && folder > 0 ? folder : null
}

/** `items.delete` is B3's for library delete; here only the in-folder case. */
function removeAvailability(fromLibrary: boolean): Availability {
  if (fromLibrary || viewedFolder() === null) {
    return {
      ok: false,
      code: 'not-implemented',
      reason: 'Not available yet',
    }
  }
  return OK
}

let registered = false

/** Wires the folder commands. Idempotent. */
export function register(): void {
  if (registered) {
    return
  }
  registered = true

  // The keys (N, R, M, ContextMenu, Delete) are core's DEFAULT_BINDINGS. The
  // commands stay available even when they can't do anything, so a press
  // always explains itself in a toast (folders.md §9) instead of doing
  // nothing.
  implementCommand('folders.create', {
    run: async () => {
      const actions = await loadActions()
      actions.startCreate(viewedFolder() ?? 0)
    },
  })
  implementCommand('folders.rename', {
    run: async () => {
      const actions = await loadActions()
      actions.startRename(viewedFolder())
    },
  })
  implementCommand('folders.move-to', {
    run: async () => {
      const actions = await loadActions()
      actions.moveTargetsToFolder()
    },
  })
  implementCommand('folders.context-menu', {
    run: async () => {
      const actions = await loadActions()
      actions.openContextMenu(urlStore().get().folder, 'row')
    },
  })

  implementCommand(
    'folders.remove-from-folder',
    {
      available: () => removeAvailability(false),
      run: async () => {
        const actions = await loadActions()
        await actions.removeTargetsFromFolder()
      },
    },
    { label: 'Remove from folder', group: 'Folders' },
  )
  // Track B3 takes this command over in M4 (library delete and the Trash),
  // keeping the in-folder case: run `folders.remove-from-folder` there.
  implementCommand('items.delete', {
    available: (args) => removeAvailability(args?.fromLibrary ?? false),
    run: async () => {
      const actions = await loadActions()
      await actions.removeTargetsFromFolder()
    },
  })

  implementCommand(
    'folders.expand-all',
    {
      run: async () => {
        const actions = await loadActions()
        actions.expandAll()
      },
    },
    { label: 'Expand all folders', group: 'Folders' },
  )
  implementCommand(
    'folders.collapse-all',
    {
      run: async () => {
        const actions = await loadActions()
        actions.collapseAll()
      },
    },
    { label: 'Collapse all folders', group: 'Folders' },
  )

  // A logout drops the column's state; the next user's preferences load
  // when the column mounts again.
  // The store is loaded lazily with the column; if it never loaded, there
  // is nothing to reset.
  onSessionReset(() => {
    void import('./store').then((module) => module.resetFolderUi())
  })
}
