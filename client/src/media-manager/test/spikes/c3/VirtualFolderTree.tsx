import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine'
import {
  draggable,
  dropTargetForElements,
  type ElementDropTargetEventBasePayload,
  monitorForElements,
} from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { disableNativeDragPreview } from '@atlaskit/pragmatic-drag-and-drop/element/disable-native-drag-preview'
import { autoScrollForElements } from '@atlaskit/pragmatic-drag-and-drop-auto-scroll/element'
import {
  attachInstruction,
  extractInstruction,
} from '@atlaskit/pragmatic-drag-and-drop-hitbox/list-item'
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual'
import {
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  memo,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import type { Folder } from '../../../../../../shared/library-api'
import {
  type BlockReason,
  type DropAvailability,
  type DropOperation,
  type FolderIndex,
  type FolderMove,
  type FolderRow,
  flattenVisible,
  folderDropAvailability,
  indexFolders,
  MEDIA_DROP_AVAILABILITY,
  resolveFolderMove,
} from './folderTree'
import classes from './VirtualFolderTree.module.css'

// Spike C3: the folder column's tree (plan §3): a custom flattened ARIA tree,
// virtualised with TanStack Virtual, with Pragmatic drag and drop.
//
// - Rows come from flattenVisible() and are absolutely positioned by the
//   virtualiser; ARIA level / posinset / setsize carry the hierarchy, so the
//   DOM stays flat (no role=group nesting, which virtualisation can't keep).
// - Roving tabindex: one row is the Tab stop. The rangeExtractor pins the Tab
//   stop row (and the dragged row) so they never unmount.
// - Every mounted row is a draggable and a drop target. The hitbox (list-item
//   instruction: top quarter = before, middle = inside, bottom quarter =
//   after) gets the operations folderDropAvailability() allows, so the cycle
//   rule and "an open folder's bottom edge means inside" are pure rules.
// - One monitor owns the drag state: the drop indicator, the in-page preview
//   (native preview disabled), auto-expand after a hover, and the drop.
// - The scroll container auto-scrolls near its edges and is itself a drop
//   target: the empty area below the rows means "the end of the top level".

/** Drag payload of a folder row (`source.data`). */
export const FOLDER_DRAG_TYPE = 'mm/folder'
/** Drag payload of media tiles (the grid's draggables, track A1/A3). */
export const MEDIA_DRAG_TYPE = 'mm/media'

const ROW_TARGET_TYPE = 'mm/folder-row'
const ROOT_TARGET_TYPE = 'mm/folder-root'

/** Pragmatic DnD payloads are records; these are ours. */
type DragPayload = Record<string | symbol, unknown>

export type FolderDragData = DragPayload & {
  type: typeof FOLDER_DRAG_TYPE
  id: number
}

export type MediaDragData = DragPayload & {
  type: typeof MEDIA_DRAG_TYPE
  /** attachment ids, in collection order */
  ids: number[]
}

export function isFolderDragData(
  data: Record<string | symbol, unknown>,
): data is FolderDragData {
  return data.type === FOLDER_DRAG_TYPE && typeof data.id === 'number'
}

export function isMediaDragData(
  data: Record<string | symbol, unknown>,
): data is MediaDragData {
  return data.type === MEDIA_DRAG_TYPE && Array.isArray(data.ids)
}

/** Where the dragged thing would land right now (drives every visual). */
export type DropState =
  | {
      kind: 'row'
      targetId: number
      operation: DropOperation
      blocked: boolean
      reason: BlockReason | null
    }
  | { kind: 'root' }

interface DragState {
  source: FolderDragData | MediaDragData
  drop: DropState | null
}

export interface VirtualFolderTreeProps {
  /** the API's flat list (`FolderTree.folders`) */
  folders: readonly Folder[]
  /** ids of expanded folders (controlled: the column persists it) */
  expanded: ReadonlySet<number>
  onExpandedChange: (next: Set<number>) => void
  /** the folder being viewed (aria-current, the default Tab stop) */
  currentId?: number | null
  onOpen?: (id: number) => void
  onMoveFolder?: (id: number, move: FolderMove) => void
  onAssignMedia?: (folderId: number, ids: number[]) => void
  /** per-user mode: no folder drags (media can still be assigned) */
  readOnly?: boolean
  /** false with Pro's name sorting: only "inside" is offered */
  manualOrder?: boolean
  /** hover time before a closed folder expands during a drag (spec: 700) */
  autoExpandMs?: number
  /**
   * Keep the dragged row mounted while it's scrolled out of view. The drag
   * survives its unmount either way (see the C3 note); pinning keeps the
   * dimmed source and its draggable registration stable.
   */
  pinDraggedRow?: boolean
  /** px; the prototype's 30 */
  rowHeight?: number
  /** px per level; the prototype's 16 */
  indent?: number
  overscan?: number
  /** the scroll container's height (the column gives it via flex) */
  height: number | string
  'aria-label'?: string
}

/** Mutable things the long-lived DnD registrations read (no re-binding). */
interface TreeContext {
  index: FolderIndex
  rowsById: Map<number, FolderRow>
  readOnly: boolean
  manualOrder: boolean
}

function availabilityFor(
  context: TreeContext,
  source: Record<string | symbol, unknown>,
  row: FolderRow,
): DropAvailability | null {
  if (isMediaDragData(source)) {
    return MEDIA_DROP_AVAILABILITY
  }
  if (isFolderDragData(source) && !context.readOnly) {
    return folderDropAvailability(context.index, source.id, row, {
      manualOrder: context.manualOrder,
    })
  }
  return null
}

/** The innermost drop target of a drag location, as a DropState. */
function readDropState(
  location: ElementDropTargetEventBasePayload['location'],
): DropState | null {
  const innermost = location.current.dropTargets[0]
  if (!innermost) {
    return null
  }
  if (innermost.data.type === ROOT_TARGET_TYPE) {
    return { kind: 'root' }
  }
  const instruction = extractInstruction(innermost.data)
  const targetId = innermost.data.id
  if (!instruction || typeof targetId !== 'number') {
    return null
  }
  return {
    kind: 'row',
    targetId,
    operation: instruction.operation,
    blocked: instruction.blocked,
    reason: (innermost.data.reason as BlockReason | null) ?? null,
  }
}

function sameDropState(a: DropState | null, b: DropState | null): boolean {
  if (a === null || b === null) {
    return a === b
  }
  if (a.kind === 'root' || b.kind === 'root') {
    return a.kind === b.kind
  }
  return (
    a.targetId === b.targetId &&
    a.operation === b.operation &&
    a.blocked === b.blocked
  )
}

/** The preview's second line: where it lands, or why it can't. */
export function describeDrop(
  drop: DropState | null,
  rowsById: ReadonlyMap<number, FolderRow>,
  source: FolderDragData | MediaDragData,
): { text: string; valid: boolean } {
  if (!drop) {
    return { text: 'Drop on a folder', valid: false }
  }
  if (drop.kind === 'root') {
    return { text: 'Move to the top level', valid: true }
  }
  const name = rowsById.get(drop.targetId)?.folder.name ?? 'folder'
  if (drop.blocked) {
    return {
      text:
        drop.reason === 'self'
          ? 'Can’t move a folder onto itself'
          : 'Can’t move a folder into its own subfolder',
      valid: false,
    }
  }
  if (isMediaDragData(source)) {
    return { text: `Move to “${name}”`, valid: true }
  }
  switch (drop.operation) {
    case 'combine':
      return { text: `Move into “${name}”`, valid: true }
    case 'reorder-before':
      return { text: `Move before “${name}”`, valid: true }
    case 'reorder-after':
      return { text: `Move after “${name}”`, valid: true }
  }
}

export function VirtualFolderTree({
  folders,
  expanded,
  onExpandedChange,
  currentId = null,
  onOpen,
  onMoveFolder,
  onAssignMedia,
  readOnly = false,
  manualOrder = true,
  autoExpandMs = 700,
  pinDraggedRow = true,
  rowHeight = 30,
  indent = 16,
  overscan = 8,
  height,
  'aria-label': ariaLabel = 'Folders',
}: VirtualFolderTreeProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const index = useMemo(() => indexFolders(folders), [folders])
  const rows = useMemo(() => flattenVisible(index, expanded), [index, expanded])
  const rowsById = useMemo(
    () => new Map(rows.map((row) => [row.id, row])),
    [rows],
  )

  const [focusedId, setFocusedId] = useState<number | null>(null)
  const [drag, setDrag] = useState<DragState | null>(null)

  // Latest values for the DnD registrations, which live longer than a render.
  const contextRef = useRef<TreeContext>({
    index,
    rowsById,
    readOnly,
    manualOrder,
  })
  contextRef.current = { index, rowsById, readOnly, manualOrder }
  const callbacksRef = useRef({
    onMoveFolder,
    onAssignMedia,
    onExpandedChange,
    expanded,
    autoExpandMs,
  })
  callbacksRef.current = {
    onMoveFolder,
    onAssignMedia,
    onExpandedChange,
    expanded,
    autoExpandMs,
  }

  // The Tab stop: the last focused row, else the current folder, else the
  // first row (folders spec §3), falling back when it's collapsed away.
  const tabStopId =
    [focusedId, currentId].find(
      (id): id is number => id !== null && rowsById.has(id),
    ) ??
    rows[0]?.id ??
    null
  const tabStopIndex =
    tabStopId === null ? -1 : (rowsById.get(tabStopId)?.index ?? -1)
  const draggedFolderId =
    drag && isFolderDragData(drag.source) ? drag.source.id : null
  const draggedIndex =
    pinDraggedRow && draggedFolderId !== null
      ? (rowsById.get(draggedFolderId)?.index ?? -1)
      : -1

  const rangeExtractor = useCallback(
    (range: Parameters<typeof defaultRangeExtractor>[0]) => {
      const indexes = new Set(defaultRangeExtractor(range))
      if (tabStopIndex >= 0) indexes.add(tabStopIndex)
      if (draggedIndex >= 0) indexes.add(draggedIndex)
      return [...indexes].sort((a, b) => a - b)
    },
    [tabStopIndex, draggedIndex],
  )

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    getItemKey: (itemIndex) => rows[itemIndex]?.id ?? itemIndex,
    overscan,
    rangeExtractor,
  })

  // ---- Keyboard: roving tabindex -------------------------------------------

  const pendingFocusRef = useRef<number | null>(null)
  const moveFocus = useCallback(
    (id: number) => {
      const row = rowsById.get(id)
      if (!row) return
      pendingFocusRef.current = id
      setFocusedId(id)
      virtualizer.scrollToIndex(row.index, { align: 'auto' })
    },
    [rowsById, virtualizer],
  )
  // After the render that mounted (and pinned) the row, move DOM focus to it.
  useLayoutEffect(() => {
    const id = pendingFocusRef.current
    if (id === null) return
    const element = scrollRef.current?.querySelector<HTMLElement>(
      `[data-folder-id="${id}"]`,
    )
    if (element) {
      pendingFocusRef.current = null
      element.focus({ preventScroll: true })
    }
  })

  const setExpandedFor = useCallback((id: number, open: boolean) => {
    const { expanded: current } = callbacksRef.current
    if (current.has(id) === open) return
    const next = new Set(current)
    if (open) next.add(id)
    else next.delete(id)
    callbacksRef.current.onExpandedChange(next)
  }, [])

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const id = Number(
      (event.target as HTMLElement).closest<HTMLElement>('[data-folder-id]')
        ?.dataset.folderId,
    )
    const row = rowsById.get(id)
    if (!row) return
    const at = (offset: number) => rows[row.index + offset]
    let handled = true
    switch (event.key) {
      case 'ArrowDown': {
        const next = at(1)
        if (next) moveFocus(next.id)
        break
      }
      case 'ArrowUp': {
        const previous = at(-1)
        if (previous) moveFocus(previous.id)
        break
      }
      case 'Home': {
        const first = rows[0]
        if (first) moveFocus(first.id)
        break
      }
      case 'End': {
        const last = rows[rows.length - 1]
        if (last) moveFocus(last.id)
        break
      }
      case 'ArrowRight':
        if (row.hasChildren && !row.expanded) setExpandedFor(row.id, true)
        else if (row.expanded) {
          const child = at(1)
          if (child) moveFocus(child.id)
        }
        break
      case 'ArrowLeft':
        if (row.expanded) setExpandedFor(row.id, false)
        else if (row.parent !== 0) moveFocus(row.parent)
        break
      case 'Enter':
      case ' ':
        onOpen?.(row.id)
        break
      default:
        handled = false
    }
    if (handled) event.preventDefault()
  }

  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement
    const rowElement = target.closest<HTMLElement>('[data-folder-id]')
    const id = Number(rowElement?.dataset.folderId)
    const row = rowsById.get(id)
    if (!row) return
    setFocusedId(id)
    if (target.closest('[data-twisty]')) {
      setExpandedFor(id, !row.expanded)
    } else {
      onOpen?.(id)
    }
  }

  // ---- Drag and drop: the container and the monitor --------------------------

  useEffect(() => {
    const element = scrollRef.current
    if (!element) return
    const isOurs = (data: Record<string | symbol, unknown>) =>
      isFolderDragData(data) || isMediaDragData(data)

    // Auto-expand: hovering the same closed folder for autoExpandMs opens it.
    let expandTimer: ReturnType<typeof setTimeout> | undefined
    let expandTargetId: number | null = null
    function trackAutoExpand(drop: DropState | null) {
      const targetId =
        drop?.kind === 'row' && !drop.blocked ? drop.targetId : null
      if (targetId === expandTargetId) return
      clearTimeout(expandTimer)
      expandTargetId = targetId
      if (targetId === null) return
      const row = contextRef.current.rowsById.get(targetId)
      if (!row?.hasChildren || row.expanded) return
      expandTimer = setTimeout(
        () => setExpandedFor(targetId, true),
        callbacksRef.current.autoExpandMs,
      )
    }

    // The in-page preview follows the pointer without a React render.
    function movePreview(input: { clientX: number; clientY: number }) {
      const preview = previewRef.current
      if (preview) {
        preview.style.transform = `translate(${input.clientX + 16}px, ${input.clientY + 18}px)`
      }
    }

    let lastDrop: DropState | null = null
    function update(location: ElementDropTargetEventBasePayload['location']) {
      movePreview(location.current.input)
      const drop = readDropState(location)
      trackAutoExpand(drop)
      if (sameDropState(drop, lastDrop)) return
      lastDrop = drop
      setDrag((state) => (state ? { ...state, drop } : state))
    }

    return combine(
      dropTargetForElements({
        element,
        canDrop: ({ source }) =>
          isFolderDragData(source.data) && !contextRef.current.readOnly,
        getData: () => ({ type: ROOT_TARGET_TYPE }),
      }),
      autoScrollForElements({
        element,
        canScroll: ({ source }) => isOurs(source.data),
      }),
      monitorForElements({
        canMonitor: ({ source }) => isOurs(source.data),
        onDragStart: ({ source, location }) => {
          const data = source.data
          if (!isFolderDragData(data) && !isMediaDragData(data)) return
          lastDrop = readDropState(location)
          setDrag({ source: data, drop: lastDrop })
          // The preview mounts with this render; place it on the next frame.
          requestAnimationFrame(() => movePreview(location.current.input))
        },
        onDrag: ({ location }) => update(location),
        onDropTargetChange: ({ location }) => update(location),
        onDrop: ({ source, location }) => {
          clearTimeout(expandTimer)
          expandTargetId = null
          lastDrop = null
          setDrag(null)
          const drop = readDropState(location)
          const { onMoveFolder: move, onAssignMedia: assign } =
            callbacksRef.current
          if (!drop) return
          if (isMediaDragData(source.data)) {
            if (drop.kind === 'row' && !drop.blocked) {
              assign?.(drop.targetId, source.data.ids)
            }
            return
          }
          if (!isFolderDragData(source.data)) return
          if (drop.kind === 'row' && drop.blocked) return
          const result = resolveFolderMove(
            contextRef.current.index,
            source.data.id,
            drop.kind === 'root'
              ? { kind: 'root' }
              : {
                  kind: 'row',
                  targetId: drop.targetId,
                  operation: drop.operation,
                },
          )
          if (result.ok && !result.noop) {
            move?.(source.data.id, result.move)
          }
        },
      }),
      () => clearTimeout(expandTimer),
    )
  }, [setExpandedFor])

  // ---- Render --------------------------------------------------------------

  const preview =
    drag && isFolderDragData(drag.source)
      ? describeDrop(drag.drop, rowsById, drag.source)
      : null
  const previewName =
    drag && isFolderDragData(drag.source)
      ? (index.byId.get(drag.source.id)?.name ?? '')
      : ''
  const drop = drag?.drop ?? null

  return (
    <>
      <div
        ref={scrollRef}
        role='tree'
        aria-label={ariaLabel}
        className={classes.tree}
        style={{ height }}
        onKeyDown={onKeyDown}
        onClick={onClick}
        data-dragging={drag ? 'true' : undefined}
      >
        <div
          role='presentation'
          className={classes.sizer}
          style={{ height: virtualizer.getTotalSize() }}
        >
          {virtualizer.getVirtualItems().map((item) => {
            const row = rows[item.index]
            if (!row) return null
            return (
              <TreeRow
                key={row.id}
                row={row}
                start={item.start}
                height={rowHeight}
                indent={indent}
                isTabStop={row.id === tabStopId}
                isCurrent={row.id === currentId}
                isDragging={row.id === draggedFolderId}
                drop={
                  drop?.kind === 'row' && drop.targetId === row.id ? drop : null
                }
                contextRef={contextRef}
              />
            )
          })}
        </div>
      </div>
      {preview &&
        createPortal(
          <div
            ref={previewRef}
            className={classes.preview}
            data-valid={preview.valid}
            data-testid='folder-drag-preview'
            aria-hidden='true'
          >
            <span className={classes.previewTitle}>{previewName}</span>
            <span className={classes.previewTarget}>{preview.text}</span>
          </div>,
          document.body,
        )}
    </>
  )
}

interface TreeRowProps {
  row: FolderRow
  start: number
  height: number
  indent: number
  isTabStop: boolean
  isCurrent: boolean
  isDragging: boolean
  drop: Extract<DropState, { kind: 'row' }> | null
  contextRef: RefObject<TreeContext>
}

/**
 * One treeitem. Registers itself as a draggable and a drop target while
 * mounted; the virtualiser mounts only the visible (and pinned) rows, so a
 * 5k tree has ~40 registrations, not 5k.
 */
const TreeRow = memo(function TreeRow({
  row,
  start,
  height,
  indent,
  isTabStop,
  isCurrent,
  isDragging,
  drop,
  contextRef,
}: TreeRowProps) {
  const ref = useRef<HTMLDivElement>(null)
  // getData runs on every dragover; it reads the latest row through a ref so
  // the registration survives re-renders (expand/collapse, moves).
  const rowRef = useRef(row)
  rowRef.current = row

  useEffect(() => {
    const element = ref.current
    if (!element) return
    return combine(
      draggable({
        element,
        canDrag: () => !contextRef.current.readOnly,
        getInitialData: (): FolderDragData => ({
          type: FOLDER_DRAG_TYPE,
          id: rowRef.current.id,
        }),
        onGenerateDragPreview: ({ nativeSetDragImage }) => {
          disableNativeDragPreview({ nativeSetDragImage })
        },
      }),
      dropTargetForElements({
        element,
        canDrop: ({ source }) =>
          availabilityFor(contextRef.current, source.data, rowRef.current) !==
          null,
        getData: ({ input, source }) => {
          const current = rowRef.current
          const availability = availabilityFor(
            contextRef.current,
            source.data,
            current,
          )
          const data = {
            type: ROW_TARGET_TYPE,
            id: current.id,
            reason: availability?.reason ?? null,
          }
          if (!availability) return data
          return attachInstruction(data, {
            input,
            element,
            operations: availability.operations,
            axis: 'vertical',
          })
        },
      }),
    )
  }, [contextRef])

  const style = {
    height,
    transform: `translateY(${start}px)`,
    '--depth': row.level - 1,
    '--indent': `${indent}px`,
  } as CSSProperties

  return (
    <div
      ref={ref}
      role='treeitem'
      className={classes.row}
      style={style}
      tabIndex={isTabStop ? 0 : -1}
      aria-level={row.level}
      aria-posinset={row.posInSet}
      aria-setsize={row.setSize}
      aria-expanded={row.hasChildren ? row.expanded : undefined}
      aria-current={isCurrent ? 'true' : undefined}
      data-folder-id={row.id}
      data-dragging={isDragging ? 'true' : undefined}
      data-drop={drop && !drop.blocked ? drop.operation : undefined}
      data-drop-blocked={drop?.blocked ? 'true' : undefined}
    >
      <span
        className={classes.twisty}
        data-twisty
        data-expanded={row.expanded}
        data-empty={!row.hasChildren}
        aria-hidden='true'
      >
        ›
      </span>
      <span className={classes.name}>{row.folder.name}</span>
      <span className={classes.count}>{row.folder.count}</span>
      {drop && !drop.blocked && drop.operation !== 'combine' && (
        <span
          className={classes.line}
          data-edge={drop.operation === 'reorder-before' ? 'before' : 'after'}
          data-testid='drop-line'
        />
      )}
    </div>
  )
})
