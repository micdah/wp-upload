// The screens Boot shows for rare states (WordPress unreachable, the app
// password rejected, the plugin missing or incompatible). Loaded lazily by
// Boot, so they stay out of the initial media-manager chunk (plan §9).

import { Anchor, Button, List, Stack, Text } from '@mantine/core'
import type { PluginStatus } from '../../../../../shared/library-api'
import {
  LockIcon,
  OfflineIcon,
  PluginIcon,
  RetryIcon,
} from '../../core/ui/icons'
import { StateScreen } from './StateScreen'
import { RetryButton } from './screens'

/** `bootstrap.wp.state` is `unreachable`. */
export function WordPressUnreachableScreen({
  message,
  onRetry,
  retrying,
}: {
  message: string | null
  onRetry: () => void
  retrying: boolean
}) {
  return (
    <StateScreen
      icon={<OfflineIcon size={24} />}
      title='WordPress is unreachable'
      actions={
        <Button
          type='button'
          variant='default'
          leftSection={<RetryIcon size={16} />}
          onClick={onRetry}
          loading={retrying}
        >
          Try again
        </Button>
      }
    >
      <Text size='sm'>
        The server is running, but WordPress didn't answer it. Your media is
        safe; try again in a moment.
      </Text>
      {message && (
        <Text size='sm' c='dimmed'>
          {message}
        </Text>
      )}
    </StateScreen>
  )
}

/** `bootstrap.wp.state` is `auth_failed`: WordPress rejected the app password. */
export function AppPasswordRejectedScreen({
  message,
  onRetry,
}: {
  message: string | null
  onRetry: () => void
}) {
  return (
    <StateScreen
      icon={<LockIcon size={24} />}
      title='WordPress rejected the app password'
      actions={<RetryButton onRetry={onRetry} />}
    >
      <Text size='sm'>
        The server signs in to WordPress with an Application Password, and
        WordPress no longer accepts it. Ask whoever runs this app to create a
        new Application Password for its WordPress user and update the server's
        configuration.
      </Text>
      {message && (
        <Text size='sm' c='dimmed'>
          {message}
        </Text>
      )}
    </StateScreen>
  )
}

const BLOCKED_TITLES: Record<string, string> = {
  missing: 'Install the companion plugin',
  forbidden: 'This app needs a WordPress Editor account',
  outdated: 'Update the companion plugin',
  'too-new': 'Update this app',
}

/**
 * A plugin state in which the app can't run (plan §2.6). A minimal screen
 * until the system feature (B4) supplies the real onboarding and
 * compatibility screens.
 */
export function PluginBlockedScreen({
  plugin,
  onRetry,
}: {
  plugin: PluginStatus
  onRetry: () => void
}) {
  const canDownload =
    plugin.bundled !== null &&
    (plugin.state === 'missing' || plugin.state === 'outdated')
  const changes =
    plugin.state === 'outdated' ? (plugin.bundled?.changelog ?? []) : []
  return (
    <StateScreen
      wide
      icon={<PluginIcon size={24} />}
      title={
        BLOCKED_TITLES[plugin.state] ?? 'The companion plugin needs attention'
      }
      actions={
        <>
          {canDownload && (
            <Button component='a' href='api/library/plugin/download' download>
              Download plugin {plugin.bundled?.version}
            </Button>
          )}
          <RetryButton onRetry={onRetry} label='Check again' />
        </>
      }
    >
      {plugin.message && <Text size='sm'>{plugin.message}</Text>}
      {plugin.state === 'missing' && (
        <Text size='sm'>
          Download the plugin, then in WordPress go to Plugins → Add New →
          Upload Plugin and activate it. The same single file also works when
          placed in <code>wp-content/mu-plugins</code>.
        </Text>
      )}
      {changes.length > 0 && (
        <Stack gap='xs'>
          <Text size='sm' fw={600}>
            What's new
          </Text>
          {changes.map((entry) => (
            <Stack gap={2} key={entry.version}>
              <Text size='sm'>
                {entry.version} · {entry.date}
              </Text>
              <List size='sm'>
                {entry.changes.map((change) => (
                  <List.Item key={change}>{change}</List.Item>
                ))}
              </List>
            </Stack>
          ))}
        </Stack>
      )}
      {plugin.state === 'forbidden' && (
        <Text size='sm'>
          The WordPress user this app signs in as lacks the{' '}
          <code>upload_files</code> capability. Give it the Editor role and{' '}
          <Anchor component='button' type='button' onClick={onRetry} size='sm'>
            check again
          </Anchor>
          .
        </Text>
      )}
    </StateScreen>
  )
}
