// The `inspector` feature: the inspector rail and panel (inspector.md §1–§3).
// M2 slice: the Info tab for 0 / 1 / N targets, with autosaving Title and
// Alt text for one item. Edit image and Usage arrive with later waves; their
// tabs open a panel that says so.
//
// The shell renders InspectorPanel inside its inspector column (a flex
// <aside>, 48 px wide when closed, 48 + 312 px when open) and calls
// register() once at start-up.
//
// This entry is in the initial chunk, so it stays thin: the rail and the
// `A` command. The panel (fields, autosave store, CSS) is a lazy chunk,
// fetched as soon as the inspector mounts; bridge.ts is what both share.

import { ActionIcon, Tooltip } from '@mantine/core'
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
import { bridgeStore, resetInspectorSession } from './bridge'
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

/** The icon rail: it still talks when collapsed (the missing-alt dot). */
function Rail({ open, current }: { open: boolean; current: InspectorTab }) {
  const targets = useInspectorTargets()
  const single = targets.ids.length === 1 ? (targets.ids[0] ?? null) : null
  const { item } = useItem(single, 'tile')
  const altMissing =
    item !== null && isImageLike(item.kind) && item.alt.trim() === ''
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
          warn={tab === 'info' && altMissing}
        />
      ))}
    </nav>
  )
}

function RailTab({
  tab,
  label,
  icon,
  pressed,
  warn,
}: {
  tab: InspectorTab
  label: string
  icon: ReactNode
  pressed: boolean
  warn: boolean
}) {
  const command = useCommand('inspector.open-tab', { tab })
  const name = warn ? `${label} (alt text missing)` : label
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
        {warn && <span className={classes.dot} aria-hidden />}
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
