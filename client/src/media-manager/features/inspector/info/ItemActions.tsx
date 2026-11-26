// The Info panel's actions row (inspector.md §2 "One item" item 6 and
// "Several items"): buttons bound to commands other features implement.
// A command nobody implements yet, or one that can't run now, renders
// disabled with its reason.
//
// Disabled is `aria-disabled`, not the `disabled` attribute (as in
// shell/CommandButton.tsx): the button stays focusable, so its tooltip and
// description with the reason stay reachable; a click does nothing.

import { Button, Tooltip } from '@mantine/core'
import { type ReactNode, useId } from 'react'
import type {
  LibraryItemFull,
  LibraryItemTile,
} from '../../../../../../shared/library-api'
import type { CommandArgs, CommandName } from '../../../core/commands/registry'
import { useCommand } from '../../../core/commands/useCommand'
import { useCan } from '../../../core/perms'
import {
  CropIcon,
  DeleteIcon,
  DownloadIcon,
  FolderIcon,
} from '../../../core/ui/icons'
import classes from './Sections.module.css'

interface ActionButtonProps<K extends CommandName> {
  command: K
  args?: CommandArgs<K>[0]
  icon: ReactNode
  /** Overrides the command's label. */
  label?: string
  /** The quiet danger style (Delete). */
  danger?: boolean
  /** A reason to refuse besides the command's own (a permission check). */
  denial?: string | null
  /** Shows the command's shortcut as a key cap. */
  showShortcut?: boolean
}

/** A single printable key, the only form `aria-keyshortcuts` gets here. */
const PLAIN_KEY = /^[A-Z0-9]$/

function ActionButton<K extends CommandName>({
  command,
  args,
  icon,
  label,
  danger = false,
  denial = null,
  showShortcut = false,
}: ActionButtonProps<K>) {
  const state = useCommand(command, ...([args] as CommandArgs<K>))
  const reasonId = useId()
  const name = label ?? state.label
  const reason = denial ?? (state.enabled ? null : state.reason)
  const enabled = reason === null
  const shortcut = showShortcut ? state.shortcut : null
  return (
    <>
      <Tooltip
        label={reason ?? name}
        disabled={enabled}
        openDelay={400}
        withinPortal
        events={{ hover: true, focus: true, touch: false }}
      >
        <Button
          type='button'
          size='xs'
          variant={danger ? 'subtle' : 'default'}
          color={danger ? 'red' : undefined}
          className={classes.action}
          leftSection={icon}
          rightSection={
            shortcut ? (
              <kbd aria-hidden className={classes.kbd}>
                {shortcut}
              </kbd>
            ) : undefined
          }
          aria-keyshortcuts={
            shortcut && PLAIN_KEY.test(shortcut) ? shortcut : undefined
          }
          aria-disabled={!enabled || undefined}
          data-disabled={!enabled || undefined}
          aria-describedby={enabled ? undefined : reasonId}
          data-command={command}
          onClick={() => {
            if (enabled) {
              state.run()
            }
          }}
        >
          {name}
        </Button>
      </Tooltip>
      {/* Outside the button, so the reason isn't part of its name. */}
      {!enabled && (
        <span id={reasonId} className={classes.srOnly}>
          {reason}
        </span>
      )}
    </>
  )
}

const ICON_SIZE = 16

function Icon({ of: Of }: { of: typeof CropIcon }) {
  return <Of size={ICON_SIZE} aria-hidden className={classes.decor} />
}

export interface ItemActionsProps {
  item: LibraryItemFull | LibraryItemTile
}

/**
 * One item: Edit image `E` (raster images), Download, Delete (hidden when
 * the user may not delete the item).
 */
export function ItemActions({ item }: ItemActionsProps) {
  const editImage = useCan('edit-image', item)
  return (
    <div className={classes.actions} data-testid='item-actions'>
      {item.kind === 'image' && (
        <ActionButton
          command='inspector.edit-image'
          icon={<Icon of={CropIcon} />}
          label='Edit image'
          denial={editImage.ok ? null : editImage.reason}
          showShortcut
        />
      )}
      <ActionButton
        command='items.download'
        icon={<Icon of={DownloadIcon} />}
        label='Download'
      />
      {item.perms.delete && (
        <ActionButton
          command='items.delete'
          args={{ fromLibrary: true }}
          icon={<Icon of={DeleteIcon} />}
          label='Delete'
          danger
        />
      )}
    </div>
  )
}

export interface BatchActionsProps {
  /** Show Delete: false when the user may delete none of the items. */
  deletable?: boolean
}

/** Several items: Move to folder, Download, Delete. */
export function BatchActions({ deletable = true }: BatchActionsProps) {
  return (
    <div className={classes.actions} data-testid='batch-actions'>
      <ActionButton
        command='folders.move-to'
        icon={<Icon of={FolderIcon} />}
        label='Move to folder'
      />
      <ActionButton
        command='items.download'
        icon={<Icon of={DownloadIcon} />}
        label='Download'
      />
      {deletable && (
        <ActionButton
          command='items.delete'
          args={{ fromLibrary: true }}
          icon={<Icon of={DeleteIcon} />}
          label='Delete'
          danger
        />
      )}
    </div>
  )
}
