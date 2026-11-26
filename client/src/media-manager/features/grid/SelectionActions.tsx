// The selection bar's content (SelectionBar.tsx): a lazy chunk (D31),
// fetched when the browser is idle.

import { Button, Tooltip } from '@mantine/core'
import { type ReactNode, useEffect, useMemo, useRef } from 'react'
import { centerApi } from '../../core/collection/centerApi'
import { useCollection } from '../../core/collection/hooks'
import type { CommandArgs, CommandName } from '../../core/commands/registry'
import { useCommand } from '../../core/commands/useCommand'
import { coreStore, useCore } from '../../core/state'
import { hiddenSelectedCount } from '../../core/state/selection'
import {
  CloseIcon,
  DeleteIcon,
  DownloadIcon,
  EditIcon,
  FolderIcon,
} from '../../core/ui/icons'
import classes from './SelectionBar.module.css'

interface ActionProps<K extends CommandName> {
  command: K
  args?: CommandArgs<K>[0]
  icon: ReactNode
  label: string
  danger?: boolean
}

/**
 * A text button bound to a command. Disabled is `aria-disabled`, so the
 * tooltip with the reason stays reachable (as CommandIconButton).
 */
function ActionButton<K extends CommandName>({
  command,
  args,
  icon,
  label,
  danger = false,
}: ActionProps<K>) {
  const state = useCommand(command, ...([args] as CommandArgs<K>))
  const tip = state.enabled
    ? state.shortcut
      ? `${label} (${state.shortcut})`
      : label
    : `${label}: ${state.reason}`
  return (
    <Tooltip
      label={tip}
      openDelay={400}
      withinPortal
      events={{ hover: true, focus: true, touch: false }}
    >
      <Button
        type='button'
        variant='subtle'
        color='gray'
        size='compact-sm'
        leftSection={icon}
        className={classes.barAction}
        data-danger={danger || undefined}
        aria-disabled={!state.enabled || undefined}
        data-disabled={!state.enabled || undefined}
        onClick={state.run}
      >
        {label}
      </Button>
    </Tooltip>
  )
}

function clearSelection(): void {
  const clear = coreStore.getState()
  const focus = clear.focus
  clear.clearSelection()
  // The bar (and the button that had focus) is gone: back to the grid.
  if (focus !== null) {
    centerApi.focusTile(focus)
  }
}

export function Bar({ count }: { count: number }) {
  const selection = useCore((state) => state.selection)
  const hasFolders = useCore((state) =>
    Boolean(state.bootstrap?.site?.filebird?.active),
  )
  const { ids } = useCollection()
  // Focus inside the bar when it goes away (Esc on a button, an action that
  // empties the selection) would fall to <body>: give it back to the grid.
  const focusInside = useRef(false)
  useEffect(
    () => () => {
      const active = document.activeElement
      if (
        focusInside.current &&
        (active === null || active === document.body)
      ) {
        const focus = coreStore.getState().focus
        if (focus !== null) centerApi.focusTile(focus)
      }
    },
    [],
  )
  const hidden = useMemo(
    () => hiddenSelectedCount({ selection, anchor: null, focus: null }, ids),
    [selection, ids],
  )
  return (
    // biome-ignore lint/a11y/useSemanticElements: a group of actions, not a fieldset
    <div
      className={classes.selectionBar}
      role='group'
      aria-label='Selection'
      data-mm-selection-bar=''
      onFocus={() => {
        focusInside.current = true
      }}
      onBlur={(event) => {
        // Removing the focused button blurs with no related target; that
        // still counts as inside.
        if (event.relatedTarget !== null) focusInside.current = false
      }}
    >
      <Tooltip label='Clear selection (Esc)' openDelay={400} withinPortal>
        <button
          type='button'
          className={classes.barClear}
          aria-label='Clear selection'
          onClick={clearSelection}
        >
          <CloseIcon size={18} aria-hidden />
        </button>
      </Tooltip>
      <span className={classes.barCount}>
        <span className={classes.barNumber}>
          {count.toLocaleString('en')} selected
        </span>
        {hidden > 0 && (
          <span className={classes.barHidden}>
            {' · '}
            {hidden.toLocaleString('en')} hidden by filters
          </span>
        )}
      </span>
      {hasFolders && (
        <ActionButton
          command='folders.move-to'
          label='Move to folder'
          icon={<FolderIcon size={16} aria-hidden />}
        />
      )}
      <ActionButton
        command='inspector.edit-details'
        label='Edit details'
        icon={<EditIcon size={16} aria-hidden />}
      />
      <ActionButton
        command='items.download'
        label='Download'
        icon={<DownloadIcon size={16} aria-hidden />}
      />
      <span className={classes.barSpacer} />
      <ActionButton
        command='items.delete'
        label='Delete'
        danger
        icon={<DeleteIcon size={16} aria-hidden />}
      />
    </div>
  )
}
