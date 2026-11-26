// The screens shown instead of the shell. Plan §0 "gaps the design docs
// leave open": built from the design system's components, no new design.
// The login screen is a lazy chunk of its own (auth/LoginScreen.tsx).

import { Button, Text } from '@mantine/core'
import { OfflineIcon, RetryIcon } from '../../core/ui/icons'
import { StateScreen } from './StateScreen'

export function RetryButton({
  onRetry,
  label = 'Try again',
}: {
  onRetry: () => void
  label?: string
}) {
  return (
    <Button
      type='button'
      variant='default'
      leftSection={<RetryIcon size={16} />}
      onClick={onRetry}
    >
      {label}
    </Button>
  )
}

/** This app's own server didn't answer (the session check failed). */
export function ServerUnreachableScreen({ onRetry }: { onRetry: () => void }) {
  return (
    <StateScreen
      icon={<OfflineIcon size={24} />}
      title="Can't reach the server"
      actions={<RetryButton onRetry={onRetry} />}
    >
      <Text size='sm'>
        The media manager's server didn't answer. Check your connection, then
        try again.
      </Text>
    </StateScreen>
  )
}
