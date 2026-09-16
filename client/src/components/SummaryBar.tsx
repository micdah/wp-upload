import { Button, Group, Select, Text } from '@mantine/core'
import type { FileEntry, UploadStatus } from '../hooks/useUploadQueue'

const DEFAULT_MAX_CONCURRENCY = 6

function buildConcurrencyOptions(max: number | null): string[] {
  const upper = max ?? DEFAULT_MAX_CONCURRENCY
  return Array.from({ length: upper }, (_, i) => String(i + 1))
}

interface SummaryBarProps {
  items: FileEntry[]
  concurrency: number
  serverConcurrency: number | null
  onConcurrencyChange: (concurrency: number) => void
  onRetryAllFailed: () => void
  onClearCompleted: () => void
}

export function SummaryBar({
  items,
  concurrency,
  serverConcurrency,
  onConcurrencyChange,
  onRetryAllFailed,
  onClearCompleted,
}: SummaryBarProps) {
  const counts = items.reduce<Record<UploadStatus, number>>(
    (acc, item) => {
      acc[item.status] = (acc[item.status] || 0) + 1
      return acc
    },
    {
      checking: 0,
      queued: 0,
      uploading: 0,
      finalizing: 0,
      duplicate: 0,
      success: 0,
      error: 0,
    },
  )

  return (
    <Group justify='space-between' wrap='wrap' gap='md'>
      <Group gap='md' c='dimmed'>
        <Text size='sm'>{items.length} total</Text>
        <Text size='sm'>{counts.success} uploaded</Text>
        <Text size='sm'>{counts.error} failed</Text>
        {counts.duplicate > 0 && (
          <Text size='sm' c='yellow'>
            {counts.duplicate} need confirmation
          </Text>
        )}
        <Text size='sm'>
          {counts.checking +
            counts.queued +
            counts.uploading +
            counts.finalizing}{' '}
          in progress
        </Text>
      </Group>

      <Group gap='sm' align='center' wrap='wrap'>
        <Group gap={6} align='center'>
          <Text size='sm'>Parallel uploads:</Text>
          <Select
            value={String(concurrency)}
            onChange={(value) => {
              if (value == null) return
              onConcurrencyChange(Number(value))
            }}
            data={buildConcurrencyOptions(serverConcurrency)}
            w={70}
            allowDeselect={false}
          />
          {serverConcurrency != null && (
            <Text size='xs' c='dimmed'>
              (server allows up to {serverConcurrency} at once)
            </Text>
          )}
        </Group>
        <Button
          size='xs'
          variant='light'
          disabled={counts.error === 0}
          onClick={onRetryAllFailed}
        >
          Retry all failed
        </Button>
        <Button
          size='xs'
          variant='default'
          disabled={counts.success === 0}
          onClick={onClearCompleted}
        >
          Clear completed
        </Button>
      </Group>
    </Group>
  )
}
