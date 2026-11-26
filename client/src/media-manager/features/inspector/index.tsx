// The `inspector` feature: the inspector rail and panel (inspector.md §1–§5,
// §7–§9). Info for 0 / 1 / N targets (summary, one item's autosaving
// fields and sections, batch editing), Save & next and the alt pass, the
// Usage panel, and the Edit tab, which hosts the image editor's panel
// (track B1 registers it with `registerEditPanel`; until then a stub).
//
// The shell renders InspectorPanel inside its inspector column (a flex
// <aside>, 48 px wide when closed, 48 + 312 px when open) and calls
// register() once at start-up.
//
// This entry is in the initial chunk, so it stays thin: the rail and the
// `A`, `E` and Edit details commands. The panel (fields, autosave store, CSS) is a lazy chunk,
// fetched as soon as the inspector mounts; bridge.ts is what both share.

import { ActionIcon, Tooltip } from '@mantine/core'
import { type QueryClient, useQueryClient } from '@tanstack/react-query'
import { lazy, type ReactNode, Suspense, useEffect } from 'react'
import type { MediaKind } from '../../../../../shared/library-api'
import {
  getCurrentCollection,
  useInspectorTargets,
  useItem,
} from '../../core/collection/hooks'
import {
  type Availability,
  implementCommand,
  notifyCommandsChanged,
} from '../../core/commands/registry'
import { useCommand } from '../../core/commands/useCommand'
import { cachedItem } from '../../core/data/items'
import { can } from '../../core/perms'
import {
  coreStore,
  isInspectorOpen,
  onSessionReset,
  selectionRules,
  useCore,
} from '../../core/state'
import type { InspectorTab } from '../../core/state/store'
import { CropIcon, InfoIcon, UsageIcon } from '../../core/ui/icons'
import { noSelectProps } from '../../core/ui/noSelect'
import { urlStore } from '../../core/url/useUrlState'
import { bridgeStore, resetInspectorSession, useBridge } from './bridge'

export {
  type EditPanelComponent,
  registerEditPanel,
  setEditUnsaved,
} from './bridge'

import { isImageLike } from './format'
import classes from './Rail.module.css'

const loadPanel = () => import('./Panel')
const LazyPanel = lazy(() =>
  loadPanel().then((module) => ({ default: module.Panel })),
)

const TABS: readonly {
  tab: InspectorTab
  label: string
  Icon: typeof InfoIcon
}[] = [
  { tab: 'info', label: 'Info', Icon: InfoIcon },
  { tab: 'edit', label: 'Edit image', Icon: CropIcon },
  { tab: 'usage', label: 'Usage', Icon: UsageIcon },
]

export function InspectorPanel() {
  const open = useCore(isInspectorOpen)
  const tab = useCore((state) => state.panels.inspectorTab)
  // Edit details' availability reads the targets' cached permissions.
  const queryClient = useQueryClient()
  useEffect(() => {
    client = queryClient
    notifyCommandsChanged()
    return () => {
      if (client === queryClient) {
        client = null
      }
    }
  }, [queryClient])
  // Fetch the panel even while collapsed, so opening it is instant.
  useEffect(() => {
    void loadPanel()
  }, [])
  return (
    <>
      <Rail open={open} current={tab} />
      {open && (
        <Suspense fallback={null}>
          <LazyPanel tab={tab} />
        </Suspense>
      )}
    </>
  )
}

/**
 * The icon rail. It still talks when collapsed: a warn dot on Info while
 * the item lacks alt text, the number of places that use it on Usage, and
 * an accent dot on Edit while edits are unsaved.
 */
function Rail({ open, current }: { open: boolean; current: InspectorTab }) {
  const targets = useInspectorTargets()
  const single = targets.ids.length === 1 ? (targets.ids[0] ?? null) : null
  const { item } = useItem(single, 'tile')
  const { item: full } = useItem(single, 'full')
  const editUnsaved = useBridge((state) => state.editUnsaved)
  const altMissing =
    item !== null && isImageLike(item.kind) && item.alt.trim() === ''
  const usageCount = full?.usageCount ?? 0
  const badges: Record<InspectorTab, Badge | null> = {
    info: altMissing ? { kind: 'warn', says: 'alt text missing' } : null,
    edit: editUnsaved ? { kind: 'accent', says: 'unsaved edits' } : null,
    usage:
      usageCount > 0
        ? {
            kind: 'count',
            count: usageCount,
            says: `used in ${usageCount === 1 ? '1 place' : `${usageCount} places`}`,
          }
        : null,
  }
  return (
    <nav
      className={classes.rail}
      aria-label='Inspector panels'
      data-open={open || undefined}
      {...noSelectProps}
    >
      {TABS.map(({ tab, label, Icon }) => (
        <RailTab
          key={tab}
          tab={tab}
          label={label}
          icon={<Icon size={20} stroke={1.5} aria-hidden />}
          pressed={open && current === tab}
          badge={badges[tab]}
        />
      ))}
    </nav>
  )
}

type Badge =
  | { kind: 'warn' | 'accent'; says: string }
  | { kind: 'count'; count: number; says: string }

function RailTab({
  tab,
  label,
  icon,
  pressed,
  badge,
}: {
  tab: InspectorTab
  label: string
  icon: ReactNode
  pressed: boolean
  badge: Badge | null
}) {
  const command = useCommand('inspector.open-tab', { tab })
  const name = badge ? `${label} (${badge.says})` : label
  return (
    <Tooltip
      label={name}
      position='left'
      openDelay={400}
      withinPortal
      events={{ hover: true, focus: true, touch: false }}
    >
      <ActionIcon
        type='button'
        variant='subtle'
        color='gray'
        size='lg'
        className={classes.tab}
        aria-label={name}
        aria-pressed={pressed}
        data-tab={tab}
        onClick={command.run}
      >
        {icon}
        {badge?.kind === 'count' ? (
          // The number is drawn by CSS (attr): as text it would be part of
          // the button's visible label, which the name must then contain
          // word for word (axe label-content-name-mismatch).
          <span
            className={classes.count}
            data-count={badge.count > 99 ? '99+' : String(badge.count)}
            aria-hidden
          />
        ) : (
          badge && (
            <span className={classes.dot} data-tone={badge.kind} aria-hidden />
          )
        )}
      </ActionIcon>
    </Tooltip>
  )
}

// ---------------------------------------------------------------------------
// The `A` command (inspector.focus-alt)
// ---------------------------------------------------------------------------

/** What the panel shows: in detail mode the item on stage (D52). */
function currentTargets(): number[] {
  const order = getCurrentCollection()?.ids ?? []
  return selectionRules.inspectorTargetIds(
    coreStore.getState(),
    order,
    urlStore().get().item,
  )
}

/** The kind from the collection rows, or from the item the panel shows. */
function kindOf(id: number): MediaKind | null {
  const rows = getCurrentCollection()?.rows
  const index = rows ? rows.indexOf(id) : -1
  if (rows && index !== -1) {
    return rows.kindAt(index)
  }
  const shown = bridgeStore.getState().shown
  return shown?.id === id ? shown.kind : null
}

function unavailable(code: string, reason: string): Availability {
  return { ok: false, code, reason }
}

/** `A` needs exactly one image-like target. */
function focusAltAvailability(): Availability {
  const targets = currentTargets()
  if (targets.length === 0) {
    return unavailable('no-target', 'Select an image first')
  }
  if (targets.length > 1) {
    return unavailable('several', 'Select a single image')
  }
  const kind = kindOf(targets[0] as number)
  if (kind === null) {
    return unavailable('not-in-view', 'The item isn’t in the current view')
  }
  if (!isImageLike(kind)) {
    return unavailable('not-image', 'Only images have alt text')
  }
  return { ok: true }
}

/** Opens Info unless it shows, then the panel focuses the alt field. */
function focusAlt(): void {
  const [id] = currentTargets()
  if (id === undefined) {
    return
  }
  const state = coreStore.getState()
  if (!(isInspectorOpen(state) && state.panels.inspectorTab === 'info')) {
    state.selectInspectorTab('info')
  }
  bridgeStore.getState().requestFocus({ id, field: 'alt' })
}

// ---------------------------------------------------------------------------
// Edit details (inspector.edit-details): the selection bar's button
// ---------------------------------------------------------------------------

/** The app's query client while the inspector is mounted (cached perms). */
let client: QueryClient | null = null

/**
 * Edit details needs a target the user may edit (can('edit-meta')): not
 * offline, the plugin's batch feature, and, where the cache knows the
 * items, at least one with `perms.edit`. Unknown items count as editable;
 * the server refuses per item what it must.
 */
function editDetailsAvailability(): Availability {
  const targets = currentTargets()
  if (targets.length === 0) {
    return unavailable('no-target', 'Select media first')
  }
  const general = can('edit-meta')
  if (!general.ok) {
    return general
  }
  const known = client
    ? targets.flatMap((id) => {
        const item = client ? cachedItem(client, id) : null
        return item ? [item] : []
      })
    : []
  if (known.length < targets.length) {
    return { ok: true }
  }
  let refusal: Availability | null = null
  for (const item of known) {
    const result = can('edit-meta', item)
    if (result.ok) {
      return result
    }
    refusal ??= result
  }
  return refusal ?? { ok: true }
}

/**
 * Opens the inspector on Info (the compact sheet below 900 px) and focuses
 * the first field: the batch panel's Title for several targets, the item's
 * Title for one (interaction-spec §2, inspector.md §1).
 */
function editDetails(): void {
  const targets = currentTargets()
  if (targets.length === 0) {
    return
  }
  const state = coreStore.getState()
  if (!(isInspectorOpen(state) && state.panels.inspectorTab === 'info')) {
    state.selectInspectorTab('info')
  }
  bridgeStore.getState().requestFocus({
    id: targets.length === 1 ? (targets[0] as number) : null,
    field: 'title',
  })
}

/**
 * `E`: opens the Edit tab, or collapses the inspector when it shows. The
 * editor (B1) opens its canvas when the Edit panel shows one editable
 * image; until then the tab says what editing covers.
 */
function toggleEditTab(): void {
  coreStore.getState().selectInspectorTab('edit')
}

let registered = false

export function register(): void {
  if (registered) {
    return
  }
  registered = true
  implementCommand('inspector.focus-alt', {
    available: focusAltAvailability,
    run: focusAlt,
  })
  implementCommand('inspector.edit-image', { run: toggleEditTab })
  implementCommand('inspector.edit-details', {
    available: editDetailsAvailability,
    run: editDetails,
  })
  // `A` depends on the kind of the item the panel shows.
  bridgeStore.subscribe((state, previous) => {
    if (state.shown !== previous.shown) {
      notifyCommandsChanged()
    }
  })
  // A logout drops drafts, errors and pending focus; a save still running
  // settles without a word (bridge.ts).
  onSessionReset(resetInspectorSession)
}
