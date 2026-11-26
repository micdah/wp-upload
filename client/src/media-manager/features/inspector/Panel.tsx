// The inspector's panel (312 px), loaded lazily by index.tsx: header with
// the tab name and a note, and the tab's body. Only Info has content in the
// M2 slice; Edit image and Usage say they arrive later.

import { useEffect, useId } from 'react'
import { useTargets } from '../../core/collection/hooks'
import type { InspectorTab } from '../../core/state/store'
import { useUrlState } from '../../core/url/useUrlState'
import { hasUnsavedText } from './autosave'
import { bridgeStore } from './bridge'
import { NothingSelected, SeveralSelected, SingleItem } from './InfoPanel'
import classes from './Inspector.module.css'
import { useInspector } from './store'

const TITLES: Record<InspectorTab, string> = {
  info: 'Info',
  edit: 'Edit image',
  usage: 'Usage',
}

const LATER: Record<Exclude<InspectorTab, 'info'>, string> = {
  edit: 'Editing images in place isn’t available yet. It arrives in a later version.',
  usage: 'Where a file is used isn’t shown yet. It arrives in a later version.',
}

export function Panel({ tab }: { tab: InspectorTab }) {
  const targets = useTargets()
  const detailMode = useUrlState((state) => state.item !== null)
  const headingId = useId()
  const count = targets.ids.length
  const single = count === 1 ? (targets.ids[0] ?? null) : null
  const prefix = single === null ? null : `${single}:`
  const unsaved = useInspector((state) =>
    prefix === null
      ? false
      : Object.entries(state.fields).some(
          ([key, entry]) => key.startsWith(prefix) && hasUnsavedText(entry),
        ),
  )
  useEffect(() => {
    const bridge = bridgeStore.getState()
    if (single === null) {
      bridge.setShown(null)
    }
    // A focus request (`A`) is for the item it was made on; moving on drops it.
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
            <SeveralSelected count={count} hidden={targets.hidden} />
          ) : (
            <SingleItem key={single} id={single} detailMode={detailMode} />
          )
        ) : (
          <p className={classes.notice}>{LATER[tab]}</p>
        )}
      </div>
    </section>
  )
}
