import { Button, Group, Progress, Select, Stack, Text } from '@mantine/core'
import type { FileEntry } from '../hooks/useUploadQueue'
import { computeUploadStats, type UploadStats } from '../lib/uploadStats'

const DEFAULT_MAX_CONCURRENCY = 6

const STAT_COLOR: Record<keyof Omit<UploadStats, 'total'>, string> = {
  queued: 'gray',
  inProgress: 'neon',
  duplicate: 'yellow',
  uploaded: 'green',
  failed: 'red',
}

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
  const { queued, inProgress, duplicate, uploaded, failed, total } =
    computeUploadStats(items)

  return (
    <Stack gap='xs'>
      <Group justify='space-between' wrap='nowrap' gap='md'>
        <Progress.Root
          size={32}
          flex={1}
          styles={{
            label: { fontSize: 'var(--mantine-font-size-md)', fontWeight: 700 },
          }}
        >
          {failed > 0 && (
            <Progress.Section
              value={(failed / total) * 100}
              color={STAT_COLOR.failed}
            >
              <Progress.Label>{failed}</Progress.Label>
            </Progress.Section>
          )}
          {duplicate > 0 && (
            <Progress.Section
              value={(duplicate / total) * 100}
              color={STAT_COLOR.duplicate}
            >
              <Progress.Label>{duplicate}</Progress.Label>
            </Progress.Section>
          )}
          {uploaded > 0 && (
            <Progress.Section
              value={(uploaded / total) * 100}
              color={STAT_COLOR.uploaded}
            >
              <Progress.Label>{uploaded}</Progress.Label>
            </Progress.Section>
          )}
          {inProgress > 0 && (
            <Progress.Section
              value={(inProgress / total) * 100}
              color={STAT_COLOR.inProgress}
            >
              <Progress.Label>{inProgress}</Progress.Label>
            </Progress.Section>
          )}
          {queued > 0 && (
            <Progress.Section
              value={(queued / total) * 100}
              color={STAT_COLOR.queued}
            >
              <Progress.Label>{queued}</Progress.Label>
            </Progress.Section>
          )}
        </Progress.Root>
        <Text size='sm' fw={500} style={{ whiteSpace: 'nowrap' }}>
          {total} total
        </Text>
      </Group>

      <Group justify='space-between' wrap='wrap' gap='md'>
        <Group gap='md' c='dimmed'>
          <Text size='sm'>{failed} failed</Text>
          {duplicate > 0 && (
            <Text size='sm' c='yellow'>
              {duplicate} need confirmation
            </Text>
          )}
          <Text size='sm'>{uploaded} uploaded</Text>
          <Text size='sm'>{inProgress} in progress</Text>
          <Text size='sm'>{queued} queued</Text>
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
            disabled={failed === 0}
            onClick={onRetryAllFailed}
          >
            Retry all failed
          </Button>
          <Button
            size='xs'
            variant='default'
            disabled={uploaded === 0}
            onClick={onClearCompleted}
          >
            Clear completed
          </Button>
        </Group>
      </Group>
    </Stack>
  )
}
