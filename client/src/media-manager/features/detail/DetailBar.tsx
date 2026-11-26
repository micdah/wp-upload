// Detail's top bar (interaction-spec §5, prototype detail.js `renderShell`):
// Back, the title, the index (`12 / 93`, mono), then Zoom, Download and More.
// Below 900 px an Info button opens the inspector sheet (system.md §5); on a
// phone the Zoom button goes (Detail.module.css).

import {
  ActionIcon,
  Button,
  Menu,
  Tooltip,
  VisuallyHidden,
} from '@mantine/core'
import { useState } from 'react'
import type { LibraryItemFull } from '../../../../../shared/library-api'
import { type CommandName, runCommand } from '../../core/commands/registry'
import { type CommandState, useCommand } from '../../core/commands/useCommand'
import { libraryApi } from '../../core/data/api'
import { bindingsFor, formatShortcut } from '../../core/keymap/bindings'
import { useKeyLayer } from '../../core/keymap/layers'
import { isCompactViewport, useCore } from '../../core/state'
import {
  BackIcon,
  CopyIcon,
  CropIcon,
  DeleteIcon,
  DownloadIcon,
  ExternalLinkIcon,
  InfoIcon,
  MoreIcon,
  MoveIcon,
  ZoomInIcon,
} from '../../core/ui/icons'
import { noSelectProps } from '../../core/ui/noSelect'
import { toast } from '../../core/ui/toast'
import classes from './Detail.module.css'
import { type AnyItem, canZoom } from './StageMedia'

export interface DetailBarProps {
  id: number
  item: AnyItem | null
  full: LibraryItemFull | null
  title: string
  /** 0-based position in the collection, or -1 outside it. */
  index: number
  total: number
}

export function DetailBar({
  id,
  item,
  full,
  title,
  index,
  total,
}: DetailBarProps) {
  const compact = useCore((state) => isCompactViewport(state.viewport))
  return (
    <header className={classes.bar} {...noSelectProps}>
      <Tooltip label='Back to grid (Esc)' openDelay={400}>
        <ActionIcon
          variant='subtle'
          color='gray'
          size='lg'
          aria-label='Back to grid'
          onClick={() => runCommand('detail.close')}
        >
          <BackIcon size={20} />
        </ActionIcon>
      </Tooltip>
      <h2 className={classes.title} title={title}>
        {title}
      </h2>
      {index >= 0 ? (
        <span className={classes.index}>
          {index + 1} / {total}
        </span>
      ) : (
        item && <span className={classes.notInView}>Not in this view</span>
      )}
      <span className={classes.spacer} />
      {compact && <InfoButton />}
      <ZoomButton item={item} />
      <Tooltip label='Download' openDelay={400}>
        <ActionIcon
          component='a'
          href={libraryApi.downloadUrl(id)}
          variant='subtle'
          color='gray'
          size='lg'
          aria-label='Download'
        >
          <DownloadIcon size={20} />
        </ActionIcon>
      </Tooltip>
      <MoreMenu item={item} full={full} />
    </header>
  )
}

function InfoButton() {
  const toggle = useCommand('panels.toggle-inspector')
  return (
    <Tooltip label='Info (I)' openDelay={400}>
      <ActionIcon
        variant='subtle'
        color='gray'
        size='lg'
        aria-label='Info'
        onClick={() => toggle.run()}
      >
        <InfoIcon size={20} />
      </ActionIcon>
    </Tooltip>
  )
}

function zoomLabel(zoom: 'fit' | number): string {
  return zoom === 'fit' ? 'Fit' : `${Math.round(zoom * 100)} %`
}

function ZoomButton({ item }: { item: AnyItem | null }) {
  const zoom = useCore((state) => state.zoom)
  const zoomable = canZoom(item)
  const shown = zoomable ? zoom : 'fit'
  return (
    <Tooltip
      label={
        zoomable
          ? `${shown === 'fit' ? '100 %' : 'Fit'} (Z) · + and − to step`
          : 'Only images zoom'
      }
      openDelay={400}
    >
      <Button
        className={classes.zoomButton}
        variant={shown === 'fit' ? 'subtle' : 'light'}
        color='gray'
        size='compact-md'
        leftSection={<ZoomInIcon size={18} aria-hidden />}
        aria-pressed={shown !== 'fit'}
        data-disabled={zoomable ? undefined : true}
        aria-disabled={zoomable ? undefined : true}
        onClick={(event) => {
          if (!zoomable) {
            event.preventDefault()
            return
          }
          runCommand('detail.zoom-toggle')
        }}
      >
        <VisuallyHidden>Zoom </VisuallyHidden>
        <span className={classes.zoomLabel}>{zoomLabel(shown)}</span>
      </Button>
    </Tooltip>
  )
}

/** Copies text to the clipboard, also where the async API isn't there. */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Denied or unavailable: try the old way.
  }
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.append(area)
  area.select()
  let copied = false
  try {
    copied = document.execCommand('copy')
  } catch {
    copied = false
  }
  area.remove()
  return copied
}

async function copyUrl(url: string): Promise<void> {
  if (await copyText(url)) {
    toast({ message: 'URL copied', tone: 'success' })
  } else {
    toast({ message: 'Couldn’t copy the URL', tone: 'error' })
  }
}

/** The shortcut of a command's binding with Shift (Delete from library). */
function shiftShortcutFor(name: CommandName): string | null {
  const binding = bindingsFor(name).find((candidate) => candidate.shift)
  return binding ? formatShortcut(binding) : null
}

function CommandItem({
  command,
  label,
  icon,
  shortcut = command.shortcut,
  danger = false,
}: {
  command: CommandState
  label: string
  icon: React.ReactNode
  /** Overrides the command's first shortcut (when its args pick another key). */
  shortcut?: string | null
  danger?: boolean
}) {
  // Why it's off, unless that is only "not built yet" (a later track's).
  const reason =
    !command.enabled && command.code !== 'not-implemented'
      ? command.reason
      : null
  return (
    <Menu.Item
      leftSection={icon}
      rightSection={
        shortcut ? (
          <span className={classes.shortcut}>{shortcut}</span>
        ) : undefined
      }
      color={danger ? 'red' : undefined}
      disabled={!command.enabled}
      onClick={() => command.run()}
    >
      {label}
      {reason && <span className={classes.reason}>{reason}</span>}
    </Menu.Item>
  )
}

function MoreMenu({
  item,
  full,
}: {
  item: AnyItem | null
  full: LibraryItemFull | null
}) {
  const hasFolders = useCore(
    (state) => state.bootstrap?.site?.filebird?.active === true,
  )
  const move = useCommand('folders.move-to')
  const edit = useCommand('inspector.edit-image')
  const remove = useCommand('items.delete', { fromLibrary: true })
  const editUrl = full?.links.edit ?? null
  // Esc while focus is still on the trigger (before Mantine moves it into
  // the menu) closes the menu, not detail (spike C4: a layer while open).
  const [opened, setOpened] = useState(false)
  useKeyLayer('detail-more-menu', () => setOpened(false), opened)
  return (
    // No initial-focus placeholder: Mantine's is a focusable
    // role=presentation div inside role=menu, which axe flags
    // (aria-required-children). Focus goes to the first item instead.
    <Menu
      opened={opened}
      onChange={setOpened}
      position='bottom-end'
      width={240}
      withinPortal
      withInitialFocusPlaceholder={false}
      returnFocus
    >
      <Menu.Target>
        <Tooltip label='More' openDelay={400}>
          <ActionIcon
            variant='subtle'
            color='gray'
            size='lg'
            aria-label='More actions'
          >
            <MoreIcon size={20} />
          </ActionIcon>
        </Tooltip>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item
          leftSection={<CopyIcon size={16} aria-hidden />}
          disabled={!item}
          onClick={() => {
            if (item) void copyUrl(item.url)
          }}
        >
          Copy URL
        </Menu.Item>
        {editUrl ? (
          <Menu.Item
            component='a'
            href={editUrl}
            target='_blank'
            rel='noopener noreferrer'
            leftSection={<ExternalLinkIcon size={16} aria-hidden />}
          >
            Open in wp-admin
          </Menu.Item>
        ) : (
          <Menu.Item
            leftSection={<ExternalLinkIcon size={16} aria-hidden />}
            disabled
          >
            Open in wp-admin
          </Menu.Item>
        )}
        <Menu.Divider />
        {hasFolders && (
          <CommandItem
            command={move}
            label='Move to folder…'
            icon={<MoveIcon size={16} aria-hidden />}
          />
        )}
        <CommandItem
          command={edit}
          label='Edit image'
          icon={<CropIcon size={16} aria-hidden />}
        />
        <Menu.Divider />
        <CommandItem
          command={remove}
          shortcut={shiftShortcutFor('items.delete')}
          label='Delete'
          icon={<DeleteIcon size={16} aria-hidden />}
          danger
        />
      </Menu.Dropdown>
    </Menu>
  )
}
