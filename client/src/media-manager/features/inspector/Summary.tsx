// The Info panel with nothing selected (inspector.md §2 "Nothing selected"):
// the folder summary from the facets (items, size, missing alt text, not
// used), alt-text coverage with "Start alt-text pass", the type breakdown of
// the view and, for an Author, how much of it they can edit. Also the alt
// pass's strip under one item's alt field (§4).

import { Button, UnstyledButton } from '@mantine/core'
import { useQueryClient } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { Facets } from '../../../../../shared/library-api'
import { useCollection } from '../../core/collection/hooks'
import { useFacets } from '../../core/data/facets'
import { useCan } from '../../core/perms'
import { plural } from '../../core/ui/announce'
import { AlertIcon, DoneIcon } from '../../core/ui/icons'
import { urlStore } from '../../core/url/useUrlState'
import { startAltPass } from './altPass'
import { useFolderLabel } from './folderName'
import { formatBytes } from './format'
import classes from './Inspector.module.css'

/** Alt-text coverage of the current folder (facets `folder`, §7.4). */
export function coverageOf(facets: Facets | undefined): {
  images: number
  missing: number
  withAlt: number
  percent: number
} | null {
  if (!facets) {
    return null
  }
  const images = facets.folder.types.image
  const missing = Math.min(facets.folder.missingAlt, images)
  const withAlt = images - missing
  const percent = images === 0 ? 100 : Math.floor((withAlt / images) * 100)
  return { images, missing, withAlt, percent }
}

function useViewFacets() {
  const { query } = useCollection()
  return { query, facets: useFacets(query, { keepPrevious: true }).data }
}

export function Meter({ percent, label }: { percent: number; label: string }) {
  return (
    <meter
      className={classes.meter}
      aria-label={label}
      min={0}
      max={100}
      value={percent}
    />
  )
}

/** "Start alt-text pass", disabled with the reason while edits are refused. */
export function StartPassButton({ variant = 'default' }: { variant?: string }) {
  const queryClient = useQueryClient()
  const verdict = useCan('edit-meta')
  return (
    <Button
      variant={variant}
      size='xs'
      className={classes.passButton}
      disabled={!verdict.ok}
      title={verdict.ok ? undefined : verdict.reason}
      onClick={() => {
        void startAltPass(queryClient)
      }}
    >
      Start alt-text pass
    </Button>
  )
}

function Stat({
  value,
  label,
  tone,
}: {
  value: ReactNode
  label: string
  tone?: 'warn'
}) {
  return (
    <div className={classes.stat} data-tone={tone}>
      <span className={classes.statValue}>{value}</span>
      <span className={classes.statLabel}>{label}</span>
    </div>
  )
}

const TYPE_LABELS = [
  ['image', 'Images'],
  ['video', 'Videos'],
  ['audio', 'Audio'],
  ['document', 'Documents'],
] as const

export function NothingSelected() {
  const { total, status } = useCollection()
  const { query, facets } = useViewFacets()
  const folder = useFolderLabel(query.folder)
  const coverage = coverageOf(facets)
  const view = facets?.view
  const showMissingAlt = () => urlStore().navigate({ alt: 'missing' })
  return (
    <div className={classes.summary}>
      <div>
        <h3 className={classes.heading}>{folder}</h3>
        <p className={classes.sub}>
          {status === 'pending'
            ? 'Loading…'
            : `Nothing selected · ${plural(total, 'item')} in view`}
        </p>
      </div>
      {view && (
        <div className={classes.stats}>
          <Stat value={view.total.toLocaleString('en')} label='items' />
          <Stat value={formatBytes(view.bytes)} label='total size' />
          <UnstyledButton
            className={classes.statButton}
            onClick={showMissingAlt}
            disabled={view.missingAlt === 0 || query.alt === 'missing'}
            title='Show the items without alt text'
          >
            <Stat
              value={view.missingAlt.toLocaleString('en')}
              label='missing alt text'
              tone={view.missingAlt > 0 ? 'warn' : undefined}
            />
          </UnstyledButton>
          <Stat
            value={view.unused.toLocaleString('en')}
            label={
              facets.usageComplete
                ? 'not used anywhere'
                : 'not used anywhere (index incomplete)'
            }
          />
        </div>
      )}
      {coverage && coverage.images > 0 && (
        <section className={classes.section} aria-label='Alt text coverage'>
          <h4 className={classes.sectionTitle}>Alt text</h4>
          <p className={classes.coverageLine}>
            <span>
              <strong>{coverage.withAlt.toLocaleString('en')}</strong> of{' '}
              {plural(coverage.images, 'image')} in {folder} have alt text
            </span>
            <span className={classes.percent}>{coverage.percent}%</span>
          </p>
          <Meter
            percent={coverage.percent}
            label={`Alt text coverage in ${folder}`}
          />
          {coverage.missing > 0 ? (
            <>
              <StartPassButton />
              <p className={classes.hint}>
                Walks through the {plural(coverage.missing, 'image')} without
                alt text. <kbd className={classes.kbd}>Enter</kbd> saves and
                moves to the next.
              </p>
            </>
          ) : (
            <p className={classes.okLine}>
              <DoneIcon size={14} aria-hidden /> Every image here has alt text
            </p>
          )}
        </section>
      )}
      {view && (
        <section className={classes.section} aria-label='In this view'>
          <h4 className={classes.sectionTitle}>In this view</h4>
          <dl className={classes.types}>
            {TYPE_LABELS.map(([type, label]) => (
              <div key={type} className={classes.typeRow}>
                <dt>{label}</dt>
                <dd>{view.types[type].toLocaleString('en')}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      {view && view.editable < view.total && (
        <p className={classes.notice}>
          You can edit {view.editable.toLocaleString('en')} of{' '}
          {plural(view.total, 'item')} here — the ones you uploaded.
        </p>
      )}
      <p className={classes.hint}>
        Select an item to see its details.{' '}
        <kbd className={classes.kbd}>Enter</kbd> opens it,{' '}
        <kbd className={classes.kbd}>E</kbd> edits an image.
      </p>
    </div>
  )
}

/**
 * Under one item's alt field while it is focused or the item lacks alt
 * text (§4): "3 missing in Blog / 2026", the coverage meter, the position
 * in the view and, while focused, the keys.
 */
export function AltPassStrip({
  id,
  focused,
  missing,
}: {
  id: number
  focused: boolean
  missing: boolean
}) {
  const { rows, total } = useCollection()
  const { query, facets } = useViewFacets()
  const folder = useFolderLabel(query.folder)
  const coverage = coverageOf(facets)
  if (!(focused || missing) || !coverage) {
    return null
  }
  const index = rows.indexOf(id)
  return (
    <div className={classes.passStrip} data-testid='alt-pass-strip'>
      <div className={classes.passTop}>
        <span>
          {coverage.missing === 0 ? (
            'None missing'
          ) : (
            <strong>{coverage.missing.toLocaleString('en')} missing</strong>
          )}{' '}
          in {folder}
        </span>
        {index >= 0 && (
          <span className={classes.position}>
            {(index + 1).toLocaleString('en')} / {total.toLocaleString('en')}
          </span>
        )}
      </div>
      <Meter
        percent={coverage.percent}
        label={`Alt text coverage in ${folder}`}
      />
      {focused && (
        <p className={classes.keys}>
          <span>
            <kbd className={classes.kbd}>Enter</kbd> save & next
          </span>
          <span>
            <kbd className={classes.kbd}>Shift</kbd>{' '}
            <kbd className={classes.kbd}>Enter</kbd> previous
          </span>
          <span>
            <kbd className={classes.kbd}>Esc</kbd> revert
          </span>
        </p>
      )}
    </div>
  )
}

/** The batch panel's warning when images lack alt text (§2 "Several items"). */
export function BatchAltWarning({
  missing,
  images,
}: {
  missing: number
  images: number
}) {
  return (
    <div className={classes.warnCard}>
      <AlertIcon size={16} aria-hidden className={classes.warnIcon} />
      <div className={classes.warnBody}>
        <p>
          <strong>
            {missing.toLocaleString('en')} of {images.toLocaleString('en')}
          </strong>{' '}
          images have no alt text. Alt text should describe each image, so one
          shared text is rarely right.
        </p>
        <StartPassButton />
      </div>
    </div>
  )
}
