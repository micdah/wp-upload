// The inspector's panel (312 px), loaded lazily by index.tsx: header with
// the tab name and a note ("4 selected", "Unsaved changes"), and the tab's
// body: Info for 0 / 1 / N targets, the Edit tab (the editor's panel, or
// its stub), and Usage.

import { useEffect, useId, useMemo } from 'react'
import { useInspectorTargets } from '../../core/collection/hooks'
import type { InspectorTab } from '../../core/state/store'
import { useUrlState } from '../../core/url/useUrlState'
import { installAltPass } from './altPass'
import { hasPendingText } from './autosave'
import { BatchPanel } from './BatchPanel'
import { batchKey } from './batch'
import { bridgeStore, useBridge } from './bridge'
import { EditPanel } from './EditPanel'
import { type ItemExtras, SingleItem } from './InfoPanel'
import classes from './Inspector.module.css'
import { FileSections, ItemActions } from './info'
import { NothingSelected } from './Summary'
import { useInspector } from './store'
import { AttachedToRow, UsagePanel } from './usage/UsagePanel'

installAltPass()

/** Below one item's fields: File / Camera / Sizes, then the actions. */
const itemExtras: ItemExtras = (item) => (
  <>
    <FileSections item={item} attachedSlot={<AttachedToRow item={item} />} />
    <ItemActions item={item} />
  </>
)

const TITLES: Record<InspectorTab, string> = {
  info: 'Info',
  edit: 'Edit image',
  usage: 'Usage',
}

export function Panel({ tab }: { tab: InspectorTab }) {
  // In detail mode the item on stage, even with several selected (D52).
  const targets = useInspectorTargets()
  const detailMode = useUrlState((state) => state.item !== null)
  const headingId = useId()
  const count = targets.ids.length
  const single = count === 1 ? (targets.ids[0] ?? null) : null
  const prefix = useMemo(
    () =>
      count === 0
        ? null
        : single !== null
          ? `${single}:`
          : `batch:${batchKey(targets.ids)}:`,
    [count, single, targets.ids],
  )
  const unsavedText = useInspector((state) =>
    prefix === null
      ? false
      : Object.entries(state.fields).some(
          ([key, entry]) => key.startsWith(prefix) && hasPendingText(entry),
        ),
  )
  const unsavedEdit = useBridge((state) => state.editUnsaved)
  const unsaved = tab === 'edit' ? unsavedEdit : unsavedText
  useEffect(() => {
    const bridge = bridgeStore.getState()
    if (single === null) {
      bridge.setShown(null)
    }
    // A focus request (`A`, Save & next, Edit details) is for the item it was
    // made on, or for the batch panel (null); moving on elsewhere drops it.
    if (bridge.focusRequest && bridge.focusRequest.id !== single) {
      bridge.requestFocus(null)
    }
  }, [single])
  const note = unsaved
    ? 'Unsaved changes'
    : count > 1
      ? `${count.toLocaleString('en')} selected`
      : null
  return (
    <section
      className={classes.panel}
      aria-labelledby={headingId}
      data-testid='inspector-panel'
    >
      <header className={classes.header}>
        <h2 id={headingId} className={classes.title}>
          {TITLES[tab]}
        </h2>
        {note && (
          <span className={classes.note} data-dirty={unsaved || undefined}>
            {note}
          </span>
        )}
      </header>
      <div className={classes.body}>
        {tab === 'info' ? (
          count === 0 ? (
            <NothingSelected />
          ) : single === null ? (
            <BatchPanel ids={targets.ids} hidden={targets.hidden} />
          ) : (
            <SingleItem
              key={single}
              id={single}
              detailMode={detailMode}
              extras={itemExtras}
            />
          )
        ) : tab === 'edit' ? (
          <EditPanel ids={targets.ids} />
        ) : (
          <UsagePanel ids={targets.ids} hidden={targets.hidden} />
        )}
      </div>
    </section>
  )
}
