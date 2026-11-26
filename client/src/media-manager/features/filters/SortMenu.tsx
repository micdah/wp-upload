// The sort menu in the toolbar (interaction-spec §3): the current sort as the
// button's text, the eight orders as menu items with the current one checked
// (`aria-current`: Mantine's items are always `menuitem`). Writes `sort` with
// replace (D16); the selection is kept (§1).

import { Menu } from '@mantine/core'
import { ChevronDownIcon, SortIcon } from '../../core/ui/icons'
import { useUrlState } from '../../core/url/useUrlState'
import classes from './Filters.module.css'
import { MenuChoice, MenuGroup } from './MenuChoice'
import { SORT_LABELS, SORT_OPTIONS } from './model'

export function SortMenu() {
  // The Trash has its own order and ignores sort (server-api.md §6).
  const inTrash = useUrlState((state) => state.folder === 'trash')
  return inTrash ? null : <Sort />
}

function Sort() {
  const sort = useUrlState((state) => state.sort)
  return (
    // No initial-focus placeholder: a menu may only own items, groups and
    // separators (axe's aria-required-children).
    <Menu
      position='bottom-end'
      withinPortal
      withInitialFocusPlaceholder={false}
    >
      <Menu.Target>
        <button
          type='button'
          className={classes.sortButton}
          aria-label={`Sort: ${SORT_LABELS[sort]}`}
        >
          <SortIcon size={16} aria-hidden />
          <span>{SORT_LABELS[sort]}</span>
          <ChevronDownIcon size={14} aria-hidden />
        </button>
      </Menu.Target>
      <Menu.Dropdown className={classes.sortMenu}>
        <MenuGroup label='Sort by'>
          {SORT_OPTIONS.map(({ key, label }) => (
            <MenuChoice
              key={key}
              checked={sort === key}
              label={label}
              patch={{ sort: key }}
            />
          ))}
        </MenuGroup>
      </Menu.Dropdown>
    </Menu>
  )
}
