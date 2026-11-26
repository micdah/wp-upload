// The app shell (interaction-spec §6): "stable chrome, changing centre".
//
//   toolbar ─────────────────────────────────────────────
//   banners (system feature) ────────────────────────────
//   folders │ centre: filter bar + stack            │ inspector
//   column  │   grid (or Trash view), inert under   │ (rail +
//   (resize,│   detail/editor; overlay layers for    │ panel)
//   collapse│   peek, detail, editor                │
//
// Breakpoints: ≥ 1200 everything; 900–1199 the inspector starts collapsed;
// < 900 the folder column becomes a drawer and the inspector an overlay
// sheet (track B6 refines < 900 px and the phone layout in M4).
//
// The feature components come from features/*/index.tsx; each decides for
// itself whether it renders (e.g. DetailOverlay when `?item=` is set).

import { useEffect, useRef, useState } from 'react'
import { installRuntime } from '../app/runtime'
import { useTrackCurrentCollection } from '../core/collection/hooks'
import { useRevPolling } from '../core/data/rev'
import { MediaDragPreview } from '../core/dnd/MediaDragPreview'
import { useKeyLayer } from '../core/keymap/layers'
import {
  coreStore,
  isCompactViewport,
  isFoldersOpen,
  isInspectorOpen,
  useCore,
} from '../core/state'
import { useUrlState } from '../core/url/useUrlState'
import { CommandLayer } from '../features/command-ui'
import { DetailOverlay } from '../features/detail'
import { EditorOverlay } from '../features/editor'
import { FilterBar } from '../features/filters'
import { FolderColumn } from '../features/folders'
import { GridView } from '../features/grid'
import { InspectorPanel } from '../features/inspector'
import { PeekOverlay } from '../features/peek'
import { PhoneChrome } from '../features/phone'
import { SystemBanners } from '../features/system'
import { TrashView } from '../features/trash'
import { UploadLayer } from '../features/upload'
import { FolderResizer } from './FolderResizer'
import classes from './Shell.module.css'
import { Toolbar } from './Toolbar'
import { useFolderDrawerLayer } from './useFolderDrawerLayer'
import { useViewportTracking } from './useViewport'

export function Shell() {
  useViewportTracking()
  useEffect(() => installRuntime(), [])
  // Publishes the collection for commands (select all, detail stepping).
  useTrackCurrentCollection()
  // The one rev poll (15 s while visible; backs off while offline). A new
  // rev invalidates what changed elsewhere (core/data/invalidate.ts).
  useRevPolling()

  const viewport = useCore((state) => state.viewport)
  const compact = isCompactViewport(viewport)
  const hasFolders = useCore((state) =>
    Boolean(state.bootstrap?.site?.filebird?.active),
  )
  const foldersOpen = useCore(isFoldersOpen) && hasFolders
  const folderWidth = useCore((state) => state.panels.folderWidth)
  const inspectorOpen = useCore(isInspectorOpen)
  const overlay = useCore((state) => state.overlay)
  const detailOpen = useUrlState((state) => state.item !== null)
  const inTrash = useUrlState((state) => state.folder === 'trash')
  const [resizing, setResizing] = useState(false)
  const folderColumn = useRef<HTMLElement>(null)

  // Below 900 px the folder drawer and inspector sheet cover the centre, so
  // Esc closes them first (the drawer returning focus to its opener).
  useFolderDrawerLayer(compact && foldersOpen, folderColumn)
  useKeyLayer(
    'inspector-sheet',
    () => coreStore.getState().setInspectorOpen(false),
    compact && inspectorOpen,
  )

  const gridInert = detailOpen || overlay === 'editor'

  return (
    <div
      className={classes.app}
      data-mm-app=''
      data-viewport={viewport}
      data-folders={hasFolders ? (foldersOpen ? 'open' : 'closed') : 'none'}
      data-inspector={inspectorOpen ? 'open' : 'closed'}
      data-detail={detailOpen ? 'open' : 'closed'}
      data-resizing={resizing || undefined}
      style={{ '--folders-w': `${folderWidth}px` } as React.CSSProperties}
    >
      <Toolbar />
      <div className={classes.banners}>
        <SystemBanners />
      </div>

      {hasFolders && (
        <aside
          ref={folderColumn}
          className={classes.folders}
          aria-label='Folders'
          inert={!foldersOpen}
        >
          <FolderColumn />
          {!compact && foldersOpen && (
            <FolderResizer onResizing={setResizing} />
          )}
        </aside>
      )}

      <main className={classes.center} aria-label='Media'>
        <FilterBar />
        <div className={classes.stack}>
          <div className={classes.gridLayer} inert={gridInert}>
            {inTrash ? <TrashView /> : <GridView />}
          </div>
          <div className={classes.layer} data-mm-layer='peek'>
            <PeekOverlay />
          </div>
          <div className={classes.layer} data-mm-layer='detail'>
            <DetailOverlay />
          </div>
          <div className={classes.layer} data-mm-layer='editor'>
            <EditorOverlay />
          </div>
        </div>
      </main>

      <aside className={classes.inspector} aria-label='Inspector'>
        <InspectorPanel />
      </aside>

      {compact && (foldersOpen || inspectorOpen) && (
        <div
          className={classes.scrim}
          aria-hidden
          onClick={() => {
            coreStore.getState().setFoldersOpen(false)
            coreStore.getState().setInspectorOpen(false)
          }}
        />
      )}

      <UploadLayer />
      <CommandLayer />
      <PhoneChrome />
      <MediaDragPreview />
    </div>
  )
}
