// The filter bar above the grid (interaction-spec §3, screens.md S8): type
// chips with the folder's counts (hidden at 0), the Missing alt chip with
// its count, removable chips for the active extra filters, the "+ Filter"
// menu (size, orientation, months with media), and the live summary
// `N items · total size`.
//
// Counts come from facets (server-api.md §7.4): the `folder` scope for the
// chips and months, the `view` scope for the summary. While the folder's
// facets load, the chips are skeletons: never stale counts, never spinners
// (system.md §3, `loading`). Every filter lives in the URL and is written
// with replace (D16); changing filters keeps the selection (§1).

import { Menu } from '@mantine/core'
import type { Facets } from '../../../../../shared/library-api'
import { useCollection } from '../../core/collection/hooks'
import { useFacets } from '../../core/data/facets'
import { AddIcon, AltIcon, CloseIcon } from '../../core/ui/icons'
import { noSelectProps } from '../../core/ui/noSelect'
import type { UrlPatch } from '../../core/url/history'
import { urlStore, useUrlState } from '../../core/url/useUrlState'
import classes from './Filters.module.css'
import { MenuChoice, MenuGroup } from './MenuChoice'
import {
  activeExtraChips,
  type ExtraFilter,
  monthLabel,
  ORIENTATION_OPTIONS,
  SIZE_OPTIONS,
  summaryText,
  typeChips,
} from './model'

/** The facets of the current query, and whether they belong to it. */
function useCurrentFacets() {
  const collection = useCollection()
  const query = collection.query
  const result = useFacets(query, { keepPrevious: true })
  const data: Facets | undefined = result.data
  // The previous query's facets still hold this folder's counts (the folder
  // scope ignores the other filters); another folder's never do.
  const folder = data && data.query.folder === query.folder ? data : undefined
  const exact = data && !result.isPlaceholderData ? data : undefined
  return { collection, folder, exact }
}

/** The URL patch that removes one extra filter. */
const REMOVE: Record<ExtraFilter, UrlPatch> = {
  size: { size: null },
  orient: { orient: null },
  month: { month: null },
}

function ChipSkeletons() {
  return (
    <span className={classes.skeletons} aria-hidden>
      {[46, 72, 58, 88].map((width) => (
        <span key={width} className={classes.skeleton} style={{ width }} />
      ))}
    </span>
  )
}

function AddFilterMenu({ facets }: { facets: Facets | undefined }) {
  const size = useUrlState((state) => state.size)
  const orient = useUrlState((state) => state.orient)
  const month = useUrlState((state) => state.month)
  const months = facets?.months ?? []
  // Choosing the active value again turns that filter off.
  return (
    // No initial-focus placeholder: a menu may only own items, groups and
    // separators (axe's aria-required-children).
    <Menu
      position='bottom-start'
      withinPortal
      withInitialFocusPlaceholder={false}
    >
      <Menu.Target>
        <button type='button' className={classes.chip}>
          <AddIcon size={14} aria-hidden />
          Filter
        </button>
      </Menu.Target>
      <Menu.Dropdown className={classes.menu}>
        <MenuGroup label='Size'>
          {SIZE_OPTIONS.map(({ key, label }) => (
            <MenuChoice
              key={key}
              checked={size === key}
              label={label}
              patch={{ size: size === key ? null : key }}
            />
          ))}
        </MenuGroup>
        <Menu.Divider />
        <MenuGroup label='Orientation'>
          {ORIENTATION_OPTIONS.map(({ key, label }) => (
            <MenuChoice
              key={key}
              checked={orient === key}
              label={label}
              patch={{ orient: orient === key ? null : key }}
            />
          ))}
        </MenuGroup>
        <Menu.Divider />
        <MenuGroup label='Uploaded'>
          {months.length === 0 && (
            <Menu.Item disabled>
              {facets ? 'No months with media' : 'Loading months…'}
            </Menu.Item>
          )}
          {months.map((entry) => (
            <MenuChoice
              key={entry.month}
              checked={month === entry.month}
              label={monthLabel(entry.month)}
              count={entry.count}
              patch={{ month: month === entry.month ? null : entry.month }}
            />
          ))}
        </MenuGroup>
      </Menu.Dropdown>
    </Menu>
  )
}

export function FilterBar() {
  const inTrash = useUrlState((state) => state.folder === 'trash')
  if (inTrash) {
    // The Trash ignores every filter (server-api.md §6); B3 owns its bar.
    return null
  }
  return <Bar />
}

function Bar() {
  const type = useUrlState((state) => state.type)
  const alt = useUrlState((state) => state.alt)
  const size = useUrlState((state) => state.size)
  const orient = useUrlState((state) => state.orient)
  const month = useUrlState((state) => state.month)
  const { collection, folder, exact } = useCurrentFacets()
  const extras = activeExtraChips({ size, orient, month })
  const settled = collection.status === 'success' && !collection.isPlaceholder
  return (
    // biome-ignore lint/a11y/useSemanticElements: a group of filter toggles, not a fieldset
    <div
      className={classes.bar}
      role='group'
      aria-label='Filters'
      {...noSelectProps}
    >
      <div className={classes.chips}>
        {folder ? (
          <>
            {typeChips(folder.folder, type).map((chip) => (
              <button
                key={chip.label}
                type='button'
                className={classes.chip}
                aria-pressed={chip.active}
                onClick={() =>
                  urlStore().navigate({
                    type: chip.active ? null : chip.type,
                  })
                }
              >
                {chip.label}
                <span className={classes.count}>
                  {chip.count.toLocaleString('en')}
                </span>
              </button>
            ))}
            <button
              type='button'
              className={classes.chip}
              aria-pressed={alt === 'missing'}
              onClick={() =>
                urlStore().navigate({
                  alt: alt === 'missing' ? null : 'missing',
                })
              }
            >
              <AltIcon size={14} aria-hidden />
              Missing alt
              <span className={classes.count}>
                {folder.folder.missingAlt.toLocaleString('en')}
              </span>
            </button>
          </>
        ) : (
          <ChipSkeletons />
        )}
        {extras.map((chip) => (
          <button
            key={chip.filter}
            type='button'
            className={classes.chip}
            data-active=''
            aria-label={`Remove filter: ${chip.label}`}
            title='Remove filter'
            onClick={() => urlStore().navigate(REMOVE[chip.filter])}
          >
            {chip.label}
            <CloseIcon size={14} aria-hidden className={classes.remove} />
          </button>
        ))}
      </div>
      <AddFilterMenu facets={folder} />
      <span className={classes.summary} data-mm-summary=''>
        {settled
          ? summaryText(collection.total, exact ? exact.view.bytes : null)
          : ' '}
      </span>
    </div>
  )
}
