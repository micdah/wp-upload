import { Box, Group, Text } from '@mantine/core'
import { useEffect, useState } from 'react'
import { ServerLoadStats } from './ServerLoadStats'

export const STATUS_BAR_HEIGHT = 36
const POLL_INTERVAL_MS = 90_000

export interface StatusResponse {
  connected: boolean
  user: string | null
  reason: string | null
  wpUrl: string
  maxFileSizeMb: number
  uploadConcurrency: number
}

interface LocalStatus {
  loading: boolean
  connected?: boolean
  reason?: string | null
  wpUrl?: string
  user?: string | null
}

interface ConnectionStatusProps {
  onStatus?: (status: StatusResponse) => void
}

const DOT_COLOR = { loading: 'gray', connected: 'teal', error: 'red' }

export function ConnectionStatus({ onStatus }: ConnectionStatusProps) {
  const [status, setStatus] = useState<LocalStatus>({ loading: true })

  useEffect(() => {
    let cancelled = false

    const poll = () => {
      fetch('/api/status')
        .then((res) => res.json())
        .then((data: StatusResponse) => {
          if (cancelled) return
          setStatus({ loading: false, ...data })
          onStatus?.(data)
        })
        .catch(() => {
          if (cancelled) return
          setStatus({
            loading: false,
            connected: false,
            reason: 'Could not reach the local server. Is it running?',
          })
        })
    }

    poll()
    const intervalId = setInterval(poll, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(intervalId)
    }
  }, [onStatus])

  let state: 'loading' | 'connected' | 'error' = 'loading'
  let label = 'Checking connection…'

  if (!status.loading) {
    if (status.connected) {
      state = 'connected'
      label = `Connected to ${status.wpUrl} as ${status.user}`
    } else {
      state = 'error'
      label = `Not connected: ${status.reason || 'unknown error'}`
    }
  }

  return (
    <Box className='cyber-statusbar' h={STATUS_BAR_HEIGHT} px='md'>
      <Group gap={16} wrap='wrap' justify='center' h='100%'>
        <Group gap={8} wrap='nowrap'>
          <Box
            w={7}
            h={7}
            bg={DOT_COLOR[state]}
            style={{ borderRadius: '50%', flexShrink: 0 }}
          />
          <Text size='xs' c='dimmed' truncate maw='90%'>
            {label}
          </Text>
        </Group>
        <ServerLoadStats />
      </Group>
    </Box>
  )
}
