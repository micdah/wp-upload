// The core store (Zustand): the UI state every feature shares. Feature-local
// state (drafts, tree expansion, upload queue, …) lives in feature stores.
//
// - selection + anchor + focus (rules in selection.ts)
// - overlay: the transient layer over the centre (peek, editor, …)
// - zoom: detail mode's zoom level
// - panels: folder column and inspector (persisted in localStorage)
// - viewport: the breakpoint the shell measured
// - connectivity: online/offline as the data layer sees WordPress
// - bootstrap: the server's `bootstrap` answer once boot has it
//
// URL state (folder, filters, item, …) is not here: it lives in the URL
// (core/url), which is the source of truth for anything shareable.

import {
  createJSONStorage,
  persist,
  type StateStorage,
} from 'zustand/middleware'
import { createStore, type StoreApi } from 'zustand/vanilla'
import type { Bootstrap } from '../../../../../shared/library-api'
import * as selection from './selection'

export type Viewport = 'wide' | 'medium' | 'narrow' | 'phone'

/** Breakpoints (interaction-spec §6): the lower bound of each viewport. */
export const VIEWPORT_MIN_WIDTH = {
  wide: 1200,
  medium: 900,
  narrow: 600,
} as const

export function viewportForWidth(width: number): Viewport {
  if (width >= VIEWPORT_MIN_WIDTH.wide) {
    return 'wide'
  }
  if (width >= VIEWPORT_MIN_WIDTH.medium) {
    return 'medium'
  }
  if (width >= VIEWPORT_MIN_WIDTH.narrow) {
    return 'narrow'
  }
  return 'phone'
}

export const INSPECTOR_TABS = ['info', 'edit', 'usage'] as const
export type InspectorTab = (typeof INSPECTOR_TABS)[number]

/**
 * Overlays over the centre region. Features add their own with module
 * augmentation:
 *
 *     declare module '../../core/state/store' {
 *       interface OverlayRegistry { 'move-to': true }
 *     }
 */
export interface OverlayRegistry {
  peek: true
  editor: true
}
export type OverlayName = keyof OverlayRegistry

/** Detail zoom: Fit, then 50 %, 100 %, 200 % (interaction-spec §5). */
export const ZOOM_STEPS = ['fit', 0.5, 1, 2] as const
export type ZoomLevel = (typeof ZOOM_STEPS)[number]

export const FOLDER_WIDTH = { min: 220, max: 480, default: 280 } as const

export interface PanelsState {
  foldersOpen: boolean
  folderWidth: number
  /** The inspector's state at ≥ 1200 px (remembered). */
  inspectorOpen: boolean
  inspectorTab: InspectorTab
}

export interface Connectivity {
  state: 'online' | 'offline'
  /** When it went offline (ms since epoch); null while online. */
  since: number | null
  /** The error code or reason that made it offline. */
  reason: string | null
}

export interface CoreState extends selection.SelectionState {
  overlay: OverlayName | null
  zoom: ZoomLevel
  panels: PanelsState
  /**
   * The inspector below 1200 px. It starts collapsed there and isn't
   * remembered, so a narrow window never overrides the wide preference.
   */
  compactInspectorOpen: boolean
  /**
   * The folder drawer below 900 px: starts closed and isn't remembered,
   * like compactInspectorOpen.
   */
  compactFoldersOpen: boolean
  viewport: Viewport
  connectivity: Connectivity
  bootstrap: Bootstrap | null
}

export interface CoreActions {
  selectOnly(id: number): void
  toggleSelected(id: number): void
  selectRange(id: number, order: readonly number[], additive?: boolean): void
  selectAll(order: readonly number[]): void
  clearSelection(): void
  setSelection(ids: Iterable<number>): void
  moveFocus(
    id: number,
    mode: 'select' | 'focus-only' | 'extend',
    order?: readonly number[],
  ): void
  setFocus(id: number | null): void
  resetSelection(): void
  pruneSelection(removed: Iterable<number>): void

  openOverlay(name: OverlayName): void
  closeOverlay(name?: OverlayName): void

  setZoom(zoom: ZoomLevel): void
  stepZoom(direction: 1 | -1): void

  setPanels(patch: Partial<PanelsState>): void
  /** Opens or closes the folder column (or drawer) for the current viewport. */
  setFoldersOpen(open: boolean): void
  toggleFolders(): void
  setFolderWidth(width: number): void
  /** Opens or closes the inspector for the current viewport. */
  setInspectorOpen(open: boolean): void
  toggleInspector(): void
  /** Rail click: open that tab, or collapse when it is the open tab. */
  selectInspectorTab(tab: InspectorTab): void
  setViewport(viewport: Viewport): void

  setConnectivity(state: 'online' | 'offline', reason?: string | null): void
  setBootstrap(bootstrap: Bootstrap | null): void
}

export type CoreStore = CoreState & CoreActions

export const DEFAULT_PANELS: PanelsState = Object.freeze({
  foldersOpen: true,
  folderWidth: FOLDER_WIDTH.default,
  inspectorOpen: true,
  inspectorTab: 'info',
})

export function clampFolderWidth(width: number): number {
  if (!Number.isFinite(width)) {
    return FOLDER_WIDTH.default
  }
  return Math.round(
    Math.min(FOLDER_WIDTH.max, Math.max(FOLDER_WIDTH.min, width)),
  )
}

/** Below 900 px the folder column is a drawer. */
export function isCompactViewport(viewport: Viewport): boolean {
  return viewport === 'narrow' || viewport === 'phone'
}

/** The folder column's effective open state at a viewport. */
export function isFoldersOpen(state: CoreState): boolean {
  return isCompactViewport(state.viewport)
    ? state.compactFoldersOpen
    : state.panels.foldersOpen
}

/** The inspector's effective open state at a viewport. */
export function isInspectorOpen(state: CoreState): boolean {
  return state.viewport === 'wide'
    ? state.panels.inspectorOpen
    : state.compactInspectorOpen
}

export const PANELS_STORAGE_KEY = 'wpu-media-manager:panels'

export interface CoreStoreOptions {
  /** Where panels persist; defaults to localStorage. Tests pass a fake or null. */
  storage?: StateStorage | null
}

function pickSelection(state: CoreState): selection.SelectionState {
  return {
    selection: state.selection,
    anchor: state.anchor,
    focus: state.focus,
  }
}

function sanitisePanels(value: unknown): PanelsState {
  const raw = (
    typeof value === 'object' && value !== null ? value : {}
  ) as Record<string, unknown>
  const tab = raw.inspectorTab
  return {
    foldersOpen:
      typeof raw.foldersOpen === 'boolean'
        ? raw.foldersOpen
        : DEFAULT_PANELS.foldersOpen,
    folderWidth: clampFolderWidth(
      typeof raw.folderWidth === 'number'
        ? raw.folderWidth
        : DEFAULT_PANELS.folderWidth,
    ),
    inspectorOpen:
      typeof raw.inspectorOpen === 'boolean'
        ? raw.inspectorOpen
        : DEFAULT_PANELS.inspectorOpen,
    inspectorTab: (INSPECTOR_TABS as readonly unknown[]).includes(tab)
      ? (tab as InspectorTab)
      : DEFAULT_PANELS.inspectorTab,
  }
}

export function createCoreStore(
  options: CoreStoreOptions = {},
): StoreApi<CoreStore> {
  const storage =
    options.storage === undefined
      ? createJSONStorage<{ panels: PanelsState }>(() => window.localStorage)
      : options.storage === null
        ? undefined
        : createJSONStorage<{ panels: PanelsState }>(
            () => options.storage as StateStorage,
          )

  return createStore<CoreStore>()(
    persist(
      (set, get) => {
        const setSelectionState = (next: selection.SelectionState) => {
          const current = pickSelection(get())
          if (
            next.selection !== current.selection ||
            next.anchor !== current.anchor ||
            next.focus !== current.focus
          ) {
            set(next)
          }
        }
        const setFolders = (open: boolean) => {
          const state = get()
          if (isCompactViewport(state.viewport)) {
            set({ compactFoldersOpen: open })
          } else {
            set({ panels: { ...state.panels, foldersOpen: open } })
          }
        }
        const setInspector = (open: boolean) => {
          const state = get()
          if (state.viewport === 'wide') {
            set({ panels: { ...state.panels, inspectorOpen: open } })
          } else {
            set({ compactInspectorOpen: open })
          }
        }
        return {
          ...selection.EMPTY_SELECTION,
          overlay: null,
          zoom: 'fit',
          panels: DEFAULT_PANELS,
          compactInspectorOpen: false,
          compactFoldersOpen: false,
          viewport: 'wide',
          connectivity: { state: 'online', since: null, reason: null },
          bootstrap: null,

          selectOnly: (id) =>
            setSelectionState(selection.selectOnly(pickSelection(get()), id)),
          toggleSelected: (id) =>
            setSelectionState(selection.toggle(pickSelection(get()), id)),
          selectRange: (id, order, additive = false) =>
            setSelectionState(
              selection.rangeTo(pickSelection(get()), order, id, additive),
            ),
          selectAll: (order) =>
            setSelectionState(selection.selectAll(pickSelection(get()), order)),
          clearSelection: () =>
            setSelectionState(selection.clearSelection(pickSelection(get()))),
          setSelection: (ids) => {
            const next = new Set(ids)
            set({ selection: next, anchor: get().anchor })
          },
          moveFocus: (id, mode, order) =>
            setSelectionState(
              selection.moveFocus(pickSelection(get()), id, mode, order),
            ),
          setFocus: (id) => {
            if (get().focus !== id) {
              set({ focus: id })
            }
          },
          resetSelection: () =>
            setSelectionState(selection.resetForFolderChange()),
          pruneSelection: (removed) =>
            setSelectionState(
              selection.pruneSelection(pickSelection(get()), new Set(removed)),
            ),

          openOverlay: (name) => set({ overlay: name }),
          closeOverlay: (name) => {
            if (name === undefined || get().overlay === name) {
              set({ overlay: null })
            }
          },

          setZoom: (zoom) => set({ zoom }),
          stepZoom: (direction) => {
            const index = ZOOM_STEPS.indexOf(get().zoom)
            const next = Math.min(
              ZOOM_STEPS.length - 1,
              Math.max(0, index + direction),
            )
            set({ zoom: ZOOM_STEPS[next] })
          },

          setPanels: (patch) =>
            set({ panels: sanitisePanels({ ...get().panels, ...patch }) }),
          setFoldersOpen: setFolders,
          toggleFolders: () => setFolders(!isFoldersOpen(get())),
          setFolderWidth: (width) => {
            const { panels } = get()
            set({ panels: { ...panels, folderWidth: clampFolderWidth(width) } })
          },
          setInspectorOpen: setInspector,
          toggleInspector: () => setInspector(!isInspectorOpen(get())),
          selectInspectorTab: (tab) => {
            const state = get()
            const open = isInspectorOpen(state)
            if (open && state.panels.inspectorTab === tab) {
              setInspector(false)
              return
            }
            set({ panels: { ...get().panels, inspectorTab: tab } })
            setInspector(true)
          },
          setViewport: (viewport) => {
            if (get().viewport !== viewport) {
              set({ viewport })
            }
          },

          setConnectivity: (state, reason = null) => {
            const current = get().connectivity
            if (
              current.state === state &&
              (state === 'online' || current.reason === reason)
            ) {
              return
            }
            set({
              connectivity:
                state === 'online'
                  ? { state, since: null, reason: null }
                  : { state, since: current.since ?? Date.now(), reason },
            })
          },
          setBootstrap: (bootstrap) => set({ bootstrap }),
        }
      },
      {
        name: PANELS_STORAGE_KEY,
        version: 1,
        storage,
        partialize: (state) => ({ panels: state.panels }),
        merge: (persisted, current) => ({
          ...current,
          panels: sanitisePanels(
            (persisted as { panels?: unknown } | undefined)?.panels,
          ),
        }),
      },
    ),
  )
}
