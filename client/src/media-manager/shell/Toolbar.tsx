// The toolbar: brand, the feature slots (breadcrumb, search, sort, layout,
// density, Upload — interaction-spec §6), the panel and theme toggles, and
// the account menu with Log out.

import {
  ActionIcon,
  Group,
  Menu,
  Text,
  Tooltip,
  useComputedColorScheme,
} from '@mantine/core'
import { useAuth } from '../app/auth/AuthGate'
import { isFoldersOpen, isInspectorOpen, useCore } from '../core/state'
import {
  FoldersCollapseIcon,
  FoldersExpandIcon,
  InspectorCollapseIcon,
  InspectorExpandIcon,
  LogoutIcon,
  MoonIcon,
  SunIcon,
} from '../core/ui/icons'
import { noSelectProps } from '../core/ui/noSelect'
import { CommandIconButton } from './CommandButton'
import classes from './Shell.module.css'
import { type ToolbarSlot, useToolbarItems } from './slots'

function Slot({ slot }: { slot: ToolbarSlot }) {
  const items = useToolbarItems(slot)
  return (
    <Group
      gap='xs'
      wrap='nowrap'
      className={classes.toolbarSlot}
      data-slot={slot}
    >
      {items.map(({ id, Component }) => (
        <Component key={id} />
      ))}
    </Group>
  )
}

function AccountMenu() {
  const auth = useAuth()
  if (!auth) {
    return null
  }
  return (
    <Menu position='bottom-end' withinPortal>
      <Menu.Target>
        <Tooltip
          label={`Signed in as ${auth.session.username}`}
          openDelay={400}
        >
          <ActionIcon
            type='button'
            variant='subtle'
            color='gray'
            size='lg'
            aria-label='Account'
          >
            <Text size='sm' fw={600} component='span' aria-hidden>
              {auth.session.username.slice(0, 1).toUpperCase()}
            </Text>
          </ActionIcon>
        </Tooltip>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>{auth.session.username}</Menu.Label>
        <Menu.Item leftSection={<LogoutIcon size={16} />} onClick={auth.logout}>
          Log out
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  )
}

export function Toolbar() {
  const hasFolders = useCore((state) =>
    Boolean(state.bootstrap?.site?.filebird?.active),
  )
  const foldersOpen = useCore(isFoldersOpen)
  const inspectorOpen = useCore(isInspectorOpen)
  const dark = useComputedColorScheme('dark') === 'dark'
  return (
    <header className={classes.toolbar} {...noSelectProps}>
      <Text className={classes.brand} component='div'>
        Media
      </Text>
      <Slot slot='start' />
      <div className={classes.toolbarCenter}>
        <Slot slot='center' />
      </div>
      <Slot slot='end' />
      <Group gap={2} wrap='nowrap'>
        {/* Without FileBird there is no folder UI at all (folders.md §12.2). */}
        {hasFolders && (
          <CommandIconButton
            command='panels.toggle-folders'
            label='Folders'
            pressed={foldersOpen}
            icon={
              foldersOpen ? (
                <FoldersCollapseIcon size={20} />
              ) : (
                <FoldersExpandIcon size={20} />
              )
            }
          />
        )}
        <CommandIconButton
          command='panels.toggle-inspector'
          label='Inspector'
          pressed={inspectorOpen}
          icon={
            inspectorOpen ? (
              <InspectorCollapseIcon size={20} />
            ) : (
              <InspectorExpandIcon size={20} />
            )
          }
        />
        <CommandIconButton
          command='theme.toggle'
          label={dark ? 'Light theme' : 'Dark theme'}
          icon={dark ? <SunIcon size={20} /> : <MoonIcon size={20} />}
        />
        <AccountMenu />
      </Group>
    </header>
  )
}
