// The folder tree (folders.md §2–§3, §6): a custom flattened ARIA tree,
// virtualised with TanStack Virtual, with Pragmatic drag and drop (plan §3,
// spike C3).
//
// - Rows come from buildEntries() (entries.ts) and are absolutely positioned
//   by the virtualiser; aria-level / posinset / setsize carry the hierarchy,
//   so the DOM stays flat.
// - Roving tabindex: one row is the Tab stop (the last focused row, else the
//   folder being viewed, else the first). The rangeExtractor pins it, the
//   dragged row and the row being edited, so they never unmount.
// - Keys are handled here and claimed with preventDefault(), so everything
//   else (F, ?, Ctrl/Cmd+Z, …) still reaches the app's keymap.
// - Every mounted folder row is a draggable and a drop target; All files and
//   Uncategorized are drop targets too. The hitbox (top quarter before,
//   middle inside, bottom quarter after) gets the operations the model
//   allows, so the cycle rule and "an open folder's bottom edge means
//   inside" are pure rules. One monitor owns the drag: indicators, the
//   in-page preview, auto-expand, and the drop. The scroll container
//   auto-scrolls near its edges and is the "top level" drop area.

import {
  draggable,
  dropTargetForElements,
  type ElementDropTargetEventBasePayload,
  monitorForElements,
} from '@atlaskit/pragmatic-drag-and-drop/adapter/element-adapter'
import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine'
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
  type PointerEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { useStore } from 'zustand'
import type { FolderRef } from '../../../../../shared/library-api'
import {
  isMediaDragData,
  type MediaDragData,
  setMediaDropTarget,
} from '../../core/dnd'
import {
  ChevronRightIcon,
  DeleteIcon,
  FolderIcon,
  FolderOpenIcon,
  ImageIcon,
} from '../../core/ui/icons'
import { prefersReducedMotion } from '../../core/ui/morph'
import * as actions from './actions'
import classes from './Column.module.css'
import {
  entryRef,
  rowKey,
  type TreeEntry,
  type TreeItemEntry,
  treeItems,
} from './entries'
import {
  type DropAvailability,
  type DropOperation,
  type FolderIndex,
  folderDropAvailability,
  highlightParts,
  MEDIA_DROP_AVAILABILITY,
  resolveFolderMove,
} from './model'
import { NameInput } from './NameInput'
import {
  clearFocusRequest,
  folderUiStore,
  type RowRef,
  setFolderExpanded,
} from './store'
import { registerTreeApi } from './treeApi'

/** Drag payload of a folder row (`source.data`). */
export const FOLDER_DRAG_TYPE = 'wpu-folder'

const ROW_TARGET_TYPE = 'wpu-folder-row'
const ROOT_TARGET_TYPE = 'wpu-folder-root'

/** How long a focus request waits for its row to appear (a create's reply). */
const FOCUS_REQUEST_TTL_MS = 3000

/** How long the pointer rests on a truncated name before its full text shows. */
const NAME_TIP_DELAY_MS = 500

/**
 * Flash requests already played: a row that remounts (scrolled back into
 * view, the tree shown again) doesn't replay its "just changed" flash.
 */
let lastPlayedFlash = 0

/** Hover time before a closed folder opens during a drag (folders.md §6). */
export const AUTO_EXPAND_MS = 700

const ROW_HEIGHT = 30
const SEPARATOR_HEIGHT = 17
const INDENT = 16

type DragPayload = Record<string | symbol, unknown>

export type FolderDragData = DragPayload & {
  type: typeof FOLDER_DRAG_TYPE
  id: number
}

export function isFolderDragData(data: DragPayload): data is FolderDragData {
  return data.type === FOLDER_DRAG_TYPE && typeof data.id === 'number'
}

/** Why a row refuses a drop (shown in the preview). */
export type RefusalReason =
  | 'self'
  | 'cycle'
  | 'all-files'
  | 'pseudo'
  | 'read-only'

/** Where the dragged thing would land right now (drives every visual). */
export type DropState =
  | {
      kind: 'row'
      ref: FolderRef
      operation: DropOperation
      blocked: boolean
      reason: RefusalReason | null
    }
  | { kind: 'root' }

interface DragState {
  source: FolderDragData | MediaDragData
  drop: DropState | null
}

const BLOCK_ALL: DropAvailability['operations'] = {
  'reorder-before': 'not-available',
  'reorder-after': 'not-available',
  combine: 'blocked',
}

/** Mutable things the long-lived DnD registrations read (no re-binding). */
interface TreeContext {
  index: FolderIndex
  readOnly: boolean
  manualOrder: boolean
  entriesByRef: Map<string, TreeItemEntry>
}

/** What a row offers for the thing being dragged, or null: not a target. */
function availabilityFor(
  context: TreeContext,
  source: DragPayload,
  entry: TreeItemEntry,
): {
  operations: DropAvailability['operations']
  reason: RefusalReason | null
} | null {
  const notAFolderRow =
    entry.kind === 'new' || entry.kind === 'pending' || entry.kind === 'trash'
  if (notAFolderRow) {
    return isFolderDragData(source)
      ? { operations: BLOCK_ALL, reason: 'pseudo' }
      : null
  }
  if (isMediaDragData(source)) {
    if (entry.kind === 'all') {
      return { operations: BLOCK_ALL, reason: 'all-files' }
    }
    if (context.readOnly) {
      return { operations: BLOCK_ALL, reason: 'read-only' }
    }
    return { operations: MEDIA_DROP_AVAILABILITY.operations, reason: null }
  }
  if (isFolderDragData(source)) {
    if (entry.kind !== 'folder') {
      return { operations: BLOCK_ALL, reason: 'pseudo' }
    }
    const availability = folderDropAvailability(
      context.index,
      source.id,
      entry.row,
      { manualOrder: context.manualOrder },
    )
    return { operations: availability.operations, reason: availability.reason }
  }
  return null
}

function parseRef(value: unknown): FolderRef | null {
  if (value === 'all' || value === 'trash') return value
  return typeof value === 'number' ? value : null
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
  const ref = parseRef(innermost.data.ref)
  if (!instruction || ref === null) {
    return null
  }
  return {
    kind: 'row',
    ref,
    operation: instruction.operation,
    blocked: instruction.blocked,
    reason: (innermost.data.reason as RefusalReason | null) ?? null,
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
    a.ref === b.ref && a.operation === b.operation && a.blocked === b.blocked
  )
}

function refusalText(reason: RefusalReason | null): string {
  switch (reason) {
    case 'self':
      return 'Can’t move a folder into itself'
    case 'cycle':
      return 'Can’t move a folder into its own subfolder'
    case 'all-files':
      return 'All files isn’t a folder'
    case 'read-only':
      return 'Folders are read-only here'
    default:
      return 'Folders can’t go here'
  }
}

/** The folder drag preview's second line: where it lands, or why it can't. */
export function describeFolderDrop(
  drop: DropState | null,
  index: FolderIndex,
): { text: string; valid: boolean | null } {
  if (!drop) {
    return { text: 'Drop on a folder', valid: null }
  }
  if (drop.kind === 'root') {
    return { text: 'to the top level', valid: true }
  }
  if (drop.blocked) {
    return { text: refusalText(drop.reason), valid: false }
  }
  const name =
    typeof drop.ref === 'number' ? (index.byId.get(drop.ref)?.name ?? '') : ''
  switch (drop.operation) {
    case 'combine':
      return { text: `into “${name}”`, valid: true }
    case 'reorder-before':
      return { text: `before “${name}”`, valid: true }
    case 'reorder-after':
      return { text: `after “${name}”`, valid: true }
  }
}

/** Tells the media drag preview (core) what a drop here would do. */
function describeMediaDrop(drop: DropState | null, index: FolderIndex): void {
  if (drop?.kind !== 'row') {
    setMediaDropTarget(null)
    return
  }
  if (drop.blocked) {
    setMediaDropTarget({ label: '', refusal: refusalText(drop.reason) })
    return
  }
  const label =
    drop.ref === 0
      ? 'Uncategorized'
      : `“${typeof drop.ref === 'number' ? (index.byId.get(drop.ref)?.name ?? '') : ''}”`
  setMediaDropTarget({ label })
}

export interface TreeProps {
  id: string
  entries: TreeEntry[]
  index: FolderIndex
  /** the folder being viewed (aria-current, the default Tab stop) */
  current: FolderRef
  /** count shown for each row */
  countOf: (entry: TreeItemEntry) => number | null
  /** search text, for marking matches */
  search: string
  /** per-user mode: no folder changes */
  readOnly: boolean
  /** false with Pro's name sorting: only "inside" is offered */
  manualOrder: boolean
  /** Pro detected: folder colours show */
  pro: boolean
  /**
   * Fill the column's height, so the empty area below the rows is the "top
   * level" drop area. Off when there are no folders (the empty message
   * follows the rows).
   */
  fill: boolean
  /** Nothing to show (a search without matches): hidden, but mounted. */
  hidden?: boolean
}

export function Tree({
  id,
  entries,
  index,
  current,
  countOf,
  search,
  readOnly,
  manualOrder,
  pro,
  fill,
  hidden = false,
}: TreeProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const items = useMemo(() => treeItems(entries), [entries])
  const entriesByRef = useMemo(() => {
    const map = new Map<string, TreeItemEntry>()
    for (const entry of items) {
      const ref = entryRef(entry)
      if (ref !== null) {
        map.set(rowKey(ref), entry)
      }
    }
    return map
  }, [items])
  const positionOf = useMemo(() => {
    const map = new Map<string, number>()
    entries.forEach((entry, position) => {
      map.set(entry.key, position)
    })
    return map
  }, [entries])

  const focusedRow = useStore(folderUiStore, (state) => state.focusedRow)
  const focusRequest = useStore(folderUiStore, (state) => state.focusRequest)
  const editing = useStore(folderUiStore, (state) => state.editing)
  const flash = useStore(folderUiStore, (state) => state.flash)
  const menuRow = useStore(folderUiStore, (state) => state.menu?.row ?? null)
  const [drag, setDrag] = useState<DragState | null>(null)

  // Latest values for the DnD registrations, which live longer than a render.
  const contextRef = useRef<TreeContext>({
    index,
    readOnly,
    manualOrder,
    entriesByRef,
  })
  contextRef.current = { index, readOnly, manualOrder, entriesByRef }

  // ---- The Tab stop and the pinned rows ---------------------------------------

  const tabStopRef: FolderRef | null =
    [focusedRow, current].find(
      (ref): ref is FolderRef => ref !== null && entriesByRef.has(rowKey(ref)),
    ) ?? (items[0] ? entryRef(items[0]) : null)
  const indexOfRef = useCallback(
    (ref: RowRef | null): number => {
      if (ref === null) return -1
      const entry = entriesByRef.get(rowKey(ref))
      return entry ? (positionOf.get(entry.key) ?? -1) : -1
    },
    [entriesByRef, positionOf],
  )
  const tabStopIndex = indexOfRef(tabStopRef)
  const draggedFolderId =
    drag && isFolderDragData(drag.source) ? drag.source.id : null
  const draggedIndex = indexOfRef(draggedFolderId)
  const editingIndex =
    editing?.mode === 'rename'
      ? indexOfRef(editing.id)
      : editing?.mode === 'new'
        ? (positionOf.get('new') ?? -1)
        : -1

  const rangeExtractor = useCallback(
    (range: Parameters<typeof defaultRangeExtractor>[0]) => {
      const indexes = new Set(defaultRangeExtractor(range))
      for (const pinned of [tabStopIndex, draggedIndex, editingIndex]) {
        if (pinned >= 0) indexes.add(pinned)
      }
      return [...indexes].sort((a, b) => a - b)
    },
    [tabStopIndex, draggedIndex, editingIndex],
  )

  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (position) =>
      entries[position]?.kind === 'separator' ? SEPARATOR_HEIGHT : ROW_HEIGHT,
    getItemKey: (position) => entries[position]?.key ?? position,
    overscan: 8,
    rangeExtractor,
  })

  const rowElement = useCallback(
    (ref: RowRef) =>
      scrollRef.current?.querySelector<HTMLElement>(
        `[data-folder-row="${rowKey(ref)}"]`,
      ) ?? null,
    [],
  )

  // ---- Focus: requests from actions, and the pending DOM focus ---------------

  const pendingFocus = useRef<RowRef | null>(null)
  const moveFocus = useCallback(
    (ref: RowRef): boolean => {
      const position = indexOfRef(ref)
      if (position < 0) return false
      pendingFocus.current = ref
      folderUiStore.setState({ focusedRow: ref })
      virtualizer.scrollToIndex(position, { align: 'auto' })
      return true
    },
    [indexOfRef, virtualizer],
  )

  // A request is handled once and then cleared from the store, so a tree
  // that mounts again (after a search with no match) never replays it. A
  // request for a row that isn't in the tree yet (a folder just created:
  // the store's request renders before the tree query's new data) waits
  // for a render that has it (moveFocus changes with the rows), but only
  // briefly: a row that stays hidden must not take focus much later.
  useLayoutEffect(() => {
    if (!focusRequest) return
    if (
      moveFocus(focusRequest.row) ||
      Date.now() - focusRequest.at > FOCUS_REQUEST_TTL_MS
    ) {
      clearFocusRequest(focusRequest.seq)
    }
  }, [focusRequest, moveFocus])

  // After the render that mounted (and pinned) the row, move DOM focus to it.
  useLayoutEffect(() => {
    const ref = pendingFocus.current
    if (ref === null) return
    const element = rowElement(ref)
    if (element) {
      pendingFocus.current = null
      element.focus({ preventScroll: true })
    }
  })

  useEffect(
    () =>
      registerTreeApi({
        rowElement,
        revealRow: (ref) => {
          const position = indexOfRef(ref)
          if (position < 0) return false
          virtualizer.scrollToIndex(position, { align: 'auto' })
          return true
        },
      }),
    [rowElement, indexOfRef, virtualizer],
  )

  // ---- Keyboard (folders.md §3) ------------------------------------------------

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement
    if (target.closest('input')) return
    if (event.altKey || event.ctrlKey || event.metaKey) return
    const rowElementHit = target.closest<HTMLElement>('[data-folder-row]')
    const position = rowElementHit
      ? Number(rowElementHit.dataset.entryIndex)
      : -1
    const entry = entries[position]
    if (!entry || entry.kind === 'separator') return
    const ref = entryRef(entry)
    if (ref === null) return
    const itemPosition = items.indexOf(entry)
    const at = (offset: number) => {
      const next = items[itemPosition + offset]
      return next ? entryRef(next) : null
    }
    const go = (next: RowRef | null) => {
      if (next !== null) moveFocus(next)
    }
    const folder = entry.kind === 'folder' ? entry : null
    let handled = true
    switch (event.key) {
      case 'ArrowDown':
        go(at(1))
        break
      case 'ArrowUp':
        go(at(-1))
        break
      case 'Home':
        go(items[0] ? entryRef(items[0]) : null)
        break
      case 'End': {
        const last = items[items.length - 1]
        go(last ? entryRef(last) : null)
        break
      }
      case 'ArrowRight':
        if (folder?.row.hasChildren && !folder.row.expanded) {
          setFolderExpanded(folder.ref, true)
        } else if (folder?.row.expanded) {
          go(at(1))
        }
        break
      case 'ArrowLeft':
        if (folder?.row.expanded && search === '') {
          setFolderExpanded(folder.ref, false)
        } else if (folder && folder.row.parent !== 0) {
          go(folder.row.parent)
        }
        break
      case 'Enter':
      case ' ':
        actions.openFolder(ref)
        break
      case 'Delete':
      case 'Backspace':
        if (folder) void actions.confirmDeleteFolder(folder.ref)
        break
      case 'ContextMenu':
        actions.openContextMenu(ref, 'row')
        break
      default:
        handled = false
    }
    if (!handled && !event.shiftKey) {
      handled = true
      switch (event.key.toLowerCase()) {
        case 'n':
          actions.startCreate(folder ? folder.ref : 0)
          break
        case 'r':
          actions.startRename(folder ? folder.ref : null)
          break
        case 'm':
          if (folder) actions.moveFolderWithDialog(folder.ref)
          else actions.moveTargetsToFolder()
          break
        default:
          handled = false
      }
    }
    if (handled) event.preventDefault()
  }

  // ---- Pointer -----------------------------------------------------------------

  const entryAt = (target: HTMLElement): TreeEntry | null => {
    const element = target.closest<HTMLElement>('[data-folder-row]')
    if (!element) return null
    return entries[Number(element.dataset.entryIndex)] ?? null
  }

  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement
    if (target.closest('input')) return
    const entry = entryAt(target)
    const ref = entry ? entryRef(entry) : null
    if (!entry || ref === null) return
    folderUiStore.setState({ focusedRow: ref })
    if (entry.kind === 'folder' && target.closest('[data-twisty]')) {
      if (entry.row.hasChildren) {
        setFolderExpanded(entry.ref, !entry.row.expanded)
      }
      return
    }
    actions.openFolder(ref)
  }

  const onDoubleClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement
    if (target.closest('input, [data-twisty]')) return
    const entry = entryAt(target)
    if (entry?.kind === 'folder') {
      actions.startRename(entry.ref)
    }
  }

  const onContextMenu = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement
    if (target.closest('input')) return
    const entry = entryAt(target)
    const ref = entry ? entryRef(entry) : null
    if (ref === null) return
    event.preventDefault()
    const open = folderUiStore.getState().menu
    if (open && rowKey(open.row) === rowKey(ref)) return
    const fromKeyboard = event.clientX === 0 && event.clientY === 0
    actions.openContextMenu(
      ref,
      fromKeyboard ? 'row' : { x: event.clientX, y: event.clientY },
    )
  }

  // ---- Drag and drop: the container and the monitor --------------------------------

  useEffect(() => {
    const element = scrollRef.current
    if (!element) return
    const isOurs = (data: DragPayload) =>
      isFolderDragData(data) || isMediaDragData(data)

    // Auto-expand: hovering the same closed folder for 700 ms opens it.
    let expandTimer: ReturnType<typeof setTimeout> | undefined
    let expandTarget: number | null = null
    function trackAutoExpand(drop: DropState | null) {
      const target =
        drop?.kind === 'row' && !drop.blocked && typeof drop.ref === 'number'
          ? drop.ref
          : null
      if (target === expandTarget) return
      clearTimeout(expandTimer)
      expandTarget = target
      if (target === null || target === 0) return
      const entry = contextRef.current.entriesByRef.get(rowKey(target))
      if (
        entry?.kind !== 'folder' ||
        !entry.row.hasChildren ||
        entry.row.expanded
      ) {
        return
      }
      expandTimer = setTimeout(
        () => setFolderExpanded(target, true),
        AUTO_EXPAND_MS,
      )
    }

    // The folder preview follows the pointer without a React render.
    function movePreview(input: { clientX: number; clientY: number }) {
      const preview = previewRef.current
      if (preview) {
        preview.style.transform = `translate(${input.clientX + 16}px, ${input.clientY + 18}px)`
      }
    }

    let lastDrop: DropState | null = null
    let source: DragPayload | null = null
    function update(location: ElementDropTargetEventBasePayload['location']) {
      movePreview(location.current.input)
      const drop = readDropState(location)
      trackAutoExpand(drop)
      if (sameDropState(drop, lastDrop)) return
      lastDrop = drop
      if (source && isMediaDragData(source)) {
        describeMediaDrop(drop, contextRef.current.index)
      }
      setDrag((state) => (state ? { ...state, drop } : state))
    }

    function end() {
      clearTimeout(expandTimer)
      expandTarget = null
      lastDrop = null
      source = null
      setDrag(null)
    }

    return combine(
      dropTargetForElements({
        element,
        canDrop: ({ source: dragged }) => isFolderDragData(dragged.data),
        getData: () => ({ type: ROOT_TARGET_TYPE }),
      }),
      autoScrollForElements({
        element,
        canScroll: ({ source: dragged }) => isOurs(dragged.data),
      }),
      monitorForElements({
        canMonitor: ({ source: dragged }) => isOurs(dragged.data),
        onDragStart: ({ source: dragged, location }) => {
          const data = dragged.data
          if (!isFolderDragData(data) && !isMediaDragData(data)) return
          source = data
          lastDrop = readDropState(location)
          setDrag({ source: data, drop: lastDrop })
          // The preview mounts with this render; place it on the next frame.
          requestAnimationFrame(() => movePreview(location.current.input))
        },
        onDrag: ({ location }) => update(location),
        onDropTargetChange: ({ location }) => update(location),
        onDrop: ({ source: dragged, location }) => {
          end()
          const drop = readDropState(location)
          if (!drop) return
          const data = dragged.data
          if (isMediaDragData(data)) {
            if (drop.kind !== 'row') return
            if (drop.blocked) {
              if (drop.reason === 'read-only') {
                actions.guardFolderChange('move-to-folder')
              }
              return
            }
            if (typeof drop.ref === 'number') {
              void actions.moveItemsTo(data.ids, drop.ref)
            }
            return
          }
          if (!isFolderDragData(data)) return
          if (
            drop.kind === 'row' &&
            (drop.blocked || typeof drop.ref !== 'number')
          ) {
            return
          }
          const result = resolveFolderMove(
            contextRef.current.index,
            data.id,
            drop.kind === 'root'
              ? { kind: 'root' }
              : {
                  kind: 'row',
                  targetId: drop.ref as number,
                  operation: drop.operation,
                },
          )
          if (result.ok && !result.noop) {
            void actions.moveFolderTo(data.id, result.move)
          }
        },
      }),
      () => clearTimeout(expandTimer),
    )
  }, [])

  // ---- Render ------------------------------------------------------------------------

  const dragSource = drag?.source ?? null
  const folderPreview =
    dragSource && isFolderDragData(dragSource)
      ? describeFolderDrop(drag?.drop ?? null, index)
      : null
  const previewFolder =
    dragSource && isFolderDragData(dragSource)
      ? index.byId.get(dragSource.id)
      : undefined
  const drop = drag?.drop ?? null
  const reduceMotion = useMemo(() => prefersReducedMotion(), [])

  // The full text of a truncated name, after the pointer rests on it.
  const [nameTip, setNameTip] = useState<{
    text: string
    left: number
    top: number
  } | null>(null)
  const tipTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const hideNameTip = useCallback(() => {
    clearTimeout(tipTimer.current)
    setNameTip(null)
  }, [])
  useEffect(() => () => clearTimeout(tipTimer.current), [])
  const onPointerOver = (event: PointerEvent<HTMLDivElement>) => {
    const name = (event.target as HTMLElement).closest<HTMLElement>(
      '[data-name]',
    )
    clearTimeout(tipTimer.current)
    if (!name || drag || name.scrollWidth <= name.clientWidth) {
      setNameTip(null)
      return
    }
    tipTimer.current = setTimeout(() => {
      const rect = name.getBoundingClientRect()
      setNameTip({
        text: name.dataset.name ?? '',
        left: rect.left,
        top: rect.bottom + 4,
      })
    }, NAME_TIP_DELAY_MS)
  }

  return (
    <>
      <div
        ref={scrollRef}
        id={id}
        role='tree'
        aria-label='Folders'
        className={classes.tree}
        hidden={hidden}
        data-fill={fill ? '' : undefined}
        data-dragging={drag ? '' : undefined}
        data-drop-root={drop?.kind === 'root' ? '' : undefined}
        onKeyDown={onKeyDown}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
        onPointerOver={onPointerOver}
        onPointerLeave={hideNameTip}
        onScroll={hideNameTip}
      >
        <div
          role='presentation'
          className={classes.sizer}
          style={{ height: virtualizer.getTotalSize() }}
        >
          {virtualizer.getVirtualItems().map((item) => {
            const entry = entries[item.index]
            if (!entry) return null
            if (entry.kind === 'separator') {
              return (
                <div
                  key={entry.key}
                  aria-hidden
                  className={classes.separator}
                  style={{ transform: `translateY(${item.start}px)` }}
                />
              )
            }
            const ref = entryRef(entry)
            const rowDrop =
              drop?.kind === 'row' && ref !== null && drop.ref === ref
                ? drop
                : null
            return (
              <TreeRow
                key={entry.key}
                entry={entry}
                position={item.index}
                start={item.start}
                count={countOf(entry)}
                isTabStop={
                  ref !== null &&
                  tabStopRef !== null &&
                  rowKey(ref) === rowKey(tabStopRef)
                }
                isCurrent={ref !== null && rowKey(ref) === rowKey(current)}
                isDragging={
                  entry.kind === 'folder' && entry.ref === draggedFolderId
                }
                isRenaming={
                  editing?.mode === 'rename' &&
                  entry.kind === 'folder' &&
                  editing.id === entry.ref
                }
                menuOpen={
                  ref !== null &&
                  menuRow !== null &&
                  rowKey(ref) === rowKey(menuRow)
                }
                flashSeq={
                  flash &&
                  entry.kind === 'folder' &&
                  flash.id === entry.ref &&
                  !reduceMotion
                    ? flash.seq
                    : null
                }
                dropOperation={
                  rowDrop && !rowDrop.blocked ? rowDrop.operation : null
                }
                dropBlocked={rowDrop?.blocked ?? false}
                search={search}
                pro={pro}
                contextRef={contextRef}
              />
            )
          })}
        </div>
      </div>
      {nameTip &&
        createPortal(
          // The name is the row's accessible name already; this only shows
          // the part an ellipsis cut off.
          <div
            className={classes.nameTip}
            style={{ left: nameTip.left, top: nameTip.top }}
            data-mm-name-tip=''
            aria-hidden='true'
          >
            {nameTip.text}
          </div>,
          document.body,
        )}
      {folderPreview &&
        createPortal(
          <div
            ref={previewRef}
            className={classes.preview}
            data-valid={
              folderPreview.valid === null
                ? undefined
                : String(folderPreview.valid)
            }
            data-mm-folder-drag-preview=''
            aria-hidden='true'
          >
            <span className={classes.previewThumb}>
              <FolderGlyph
                color={pro ? (previewFolder?.color ?? null) : null}
                open={false}
              />
            </span>
            <span className={classes.previewText}>
              <span className={classes.previewTitle}>
                Move “{previewFolder?.name ?? ''}”
              </span>
              <span className={classes.previewTarget}>
                {folderPreview.text}
              </span>
            </span>
          </div>,
          document.body,
        )}
    </>
  )
}

/** The folder icon, tinted with its Pro colour (outline plus a faint fill). */
export function FolderGlyph({
  color,
  open,
}: {
  color: string | null
  open: boolean
}) {
  const Icon = open ? FolderOpenIcon : FolderIcon
  return (
    <Icon
      size={16}
      stroke={1.75}
      aria-hidden
      className={color ? classes.colored : undefined}
      style={color ? ({ '--folder-color': color } as CSSProperties) : undefined}
    />
  )
}

interface TreeRowProps {
  entry: TreeItemEntry
  position: number
  start: number
  count: number | null
  isTabStop: boolean
  isCurrent: boolean
  isDragging: boolean
  isRenaming: boolean
  menuOpen: boolean
  flashSeq: number | null
  dropOperation: DropOperation | null
  dropBlocked: boolean
  search: string
  pro: boolean
  contextRef: RefObject<TreeContext>
}

/** The row's name, with the search match marked. */
function Name({ name, search }: { name: string; search: string }) {
  const parts = highlightParts(name, search)
  if (!parts) {
    return <>{name}</>
  }
  return (
    <>
      {parts.before}
      <mark className={classes.match}>{parts.match}</mark>
      {parts.after}
    </>
  )
}

/**
 * One treeitem. Registers itself as a draggable (folders) and a drop target
 * while mounted; the virtualiser mounts only the visible (and pinned) rows,
 * so a large tree has a few dozen registrations, not thousands.
 */
const TreeRow = memo(function TreeRow({
  entry,
  position,
  start,
  count,
  isTabStop,
  isCurrent,
  isDragging,
  isRenaming,
  menuOpen,
  flashSeq,
  dropOperation,
  dropBlocked,
  search,
  pro,
  contextRef,
}: TreeRowProps) {
  const ref = useRef<HTMLDivElement>(null)
  // getData runs on every dragover; it reads the latest entry through a ref
  // so the registration survives re-renders.
  const entryRef_ = useRef(entry)
  entryRef_.current = entry
  const isRenamingRef = useRef(isRenaming)
  isRenamingRef.current = isRenaming
  const isFolder = entry.kind === 'folder'

  useEffect(() => {
    const element = ref.current
    if (!element) return
    const target = dropTargetForElements({
      element,
      canDrop: ({ source }) =>
        availabilityFor(contextRef.current, source.data, entryRef_.current) !==
        null,
      getData: ({ input, source }) => {
        const current = entryRef_.current
        const availability = availabilityFor(
          contextRef.current,
          source.data,
          current,
        )
        const data = {
          type: ROW_TARGET_TYPE,
          ref: entryRefOf(current),
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
    })
    if (!isFolder) return target
    return combine(
      target,
      draggable({
        element,
        // A refused drag (per-user mode, offline) says why in a toast.
        canDrag: () =>
          !isRenamingRef.current && actions.guardFolderChange('folder-move'),
        getInitialData: (): FolderDragData => ({
          type: FOLDER_DRAG_TYPE,
          id: (entryRef_.current as Extract<TreeItemEntry, { kind: 'folder' }>)
            .ref,
        }),
        onGenerateDragPreview: ({ nativeSetDragImage }) => {
          disableNativeDragPreview({ nativeSetDragImage })
        },
      }),
    )
  }, [contextRef, isFolder])

  // "Just changed": one accent flash, restarted by each new request.
  const [flashing, setFlashing] = useState(false)
  useEffect(() => {
    if (flashSeq === null || flashSeq <= lastPlayedFlash) return
    lastPlayedFlash = flashSeq
    setFlashing(false)
    const raf = requestAnimationFrame(() => setFlashing(true))
    const timer = setTimeout(() => setFlashing(false), 1200)
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(timer)
    }
  }, [flashSeq])

  const style = {
    height: ROW_HEIGHT,
    transform: `translateY(${start}px)`,
    '--depth': entry.level - 1,
    '--indent': `${INDENT}px`,
  } as CSSProperties

  const refValue = entryRefOf(entry)
  const common = {
    ref,
    className: classes.row,
    style,
    'aria-level': entry.level,
    'aria-posinset': entry.posInSet,
    'aria-setsize': entry.setSize,
    'data-entry-index': position,
    'data-folder-row': refValue === null ? undefined : rowKey(refValue),
  }

  if (entry.kind === 'new') {
    return (
      <div
        {...common}
        role='treeitem'
        tabIndex={-1}
        aria-label='New folder'
        data-editing=''
      >
        <span className={classes.twisty} data-empty='' aria-hidden />
        <span className={classes.icon} aria-hidden>
          <FolderIcon size={16} stroke={1.75} />
        </span>
        <NameInput initial='' label='New folder name' />
      </div>
    )
  }
  if (entry.kind === 'pending') {
    return (
      <div
        {...common}
        role='treeitem'
        tabIndex={-1}
        aria-busy='true'
        data-pending=''
      >
        <span className={classes.twisty} data-empty='' aria-hidden />
        <span className={classes.icon} aria-hidden>
          <FolderIcon size={16} stroke={1.75} />
        </span>
        <span className={classes.name}>{entry.name}</span>
      </div>
    )
  }

  let icon: ReactNode
  let name: string
  if (entry.kind === 'folder') {
    name = entry.row.folder.name
    icon = (
      <FolderGlyph
        color={pro ? entry.row.folder.color : null}
        open={entry.row.expanded}
      />
    )
  } else if (entry.kind === 'all') {
    name = 'All files'
    icon = <ImageIcon size={16} stroke={1.75} aria-hidden />
  } else if (entry.kind === 'uncategorized') {
    name = 'Uncategorized'
    icon = (
      <FolderIcon
        size={16}
        stroke={1.75}
        aria-hidden
        className={classes.muted}
      />
    )
  } else {
    name = 'Trash'
    icon = <DeleteIcon size={16} stroke={1.75} aria-hidden />
  }

  return (
    <div
      {...common}
      role='treeitem'
      tabIndex={isTabStop ? 0 : -1}
      aria-selected={isCurrent}
      aria-current={isCurrent ? 'true' : undefined}
      aria-expanded={
        isFolder && entry.kind === 'folder' && entry.row.hasChildren
          ? entry.row.expanded
          : undefined
      }
      data-current={isCurrent ? '' : undefined}
      data-dragging={isDragging ? '' : undefined}
      data-editing={isRenaming ? '' : undefined}
      data-menu-open={menuOpen ? '' : undefined}
      data-flash={flashing ? '' : undefined}
      data-drop={dropOperation ?? undefined}
      data-drop-blocked={dropBlocked ? '' : undefined}
    >
      <span
        className={classes.twisty}
        data-twisty={
          entry.kind === 'folder' && entry.row.hasChildren ? '' : undefined
        }
        data-expanded={
          entry.kind === 'folder' && entry.row.expanded ? '' : undefined
        }
        data-empty={
          entry.kind === 'folder' && entry.row.hasChildren ? undefined : ''
        }
        aria-hidden
      >
        <ChevronRightIcon size={14} stroke={2} />
      </span>
      <span className={classes.icon}>{icon}</span>
      {isRenaming ? (
        <NameInput initial={name} label={`Rename folder ${name}`} />
      ) : (
        <span className={classes.name} data-name={name}>
          {entry.kind === 'folder' && entry.match ? (
            <Name name={name} search={search} />
          ) : (
            name
          )}
        </span>
      )}
      {count !== null && !isRenaming && (
        <span className={classes.count}>
          <span className={classes.visuallyHidden}>, </span>
          {count.toLocaleString('en')}
          <span className={classes.visuallyHidden}>
            {count === 1 ? ' file' : ' files'}
          </span>
        </span>
      )}
      {dropOperation && dropOperation !== 'combine' && (
        <span
          className={classes.line}
          data-edge={dropOperation === 'reorder-before' ? 'before' : 'after'}
          aria-hidden
        />
      )}
    </div>
  )
})

function entryRefOf(entry: TreeItemEntry): FolderRef | null {
  return entryRef(entry)
}
