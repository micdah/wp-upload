import { Box, Flex, Group, Text } from '@mantine/core'
import { useEffect, useState } from 'react'
import { apiFetch } from '../lib/api'
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
  filebirdEnabled: boolean
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

    const showError = (reason: string) => {
      if (cancelled) return
      setStatus({ loading: false, connected: false, reason })
    }

    const poll = () => {
      apiFetch('api/status')
        .then(async (res) => {
          if (res.status === 401) {
            showError('Session expired. Log in again.')
            return
          }
          if (!res.ok) {
            showError(`The local server responded with HTTP ${res.status}.`)
            return
          }
          const data = (await res.json()) as StatusResponse
          if (cancelled) return
          setStatus({ loading: false, ...data })
          onStatus?.(data)
        })
        .catch(() =>
          showError('Could not reach the local server. Is it running?'),
        )
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
    <Box className='cyber-statusbar' px='md'>
      <Flex
        gap={16}
        wrap='wrap'
        justify='center'
        align='center'
        mih={STATUS_BAR_HEIGHT}
        h='100%'
      >
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
      </Flex>
    </Box>
  )
}
