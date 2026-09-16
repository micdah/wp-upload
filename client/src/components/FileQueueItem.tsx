import {
  Anchor,
  Badge,
  Button,
  Center,
  Group,
  Image,
  Paper,
  Progress,
  Stack,
  Text,
} from '@mantine/core'
import type { FileEntry, UploadStatus } from '../hooks/useUploadQueue'

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot === -1 ? '' : name.slice(dot + 1).toUpperCase()
}

const STATUS_LABEL: Record<UploadStatus, string> = {
  checking: 'Checking…',
  queued: 'Queued',
  uploading: 'Uploading',
  finalizing: 'Finalizing…',
  duplicate: 'Possible duplicate',
  success: 'Uploaded',
  error: 'Failed',
}

const STATUS_COLOR: Record<UploadStatus, string> = {
  checking: 'gray',
  queued: 'gray',
  uploading: 'neon',
  finalizing: 'neon',
  duplicate: 'yellow',
  success: 'green',
  error: 'red',
}

function Thumbnail({ item }: { item: FileEntry }) {
  if (item.previewUrl) {
    return (
      <Image
        src={item.previewUrl}
        w={48}
        h={48}
        radius='sm'
        fit='cover'
        alt=''
      />
    )
  }

  return (
    <Center
      w={48}
      h={48}
      bg='dark.5'
      style={{ borderRadius: 6, flexShrink: 0 }}
    >
      <Text size='xs' c='neon.4' fw={600}>
        {fileExtension(item.name).slice(0, 4)}
      </Text>
    </Center>
  )
}

interface FileQueueItemProps {
  item: FileEntry
  onConfirm: (id: string) => void
  onRetry: (id: string) => void
  onRemove: (id: string) => void
}

export function FileQueueItem({
  item,
  onConfirm,
  onRetry,
  onRemove,
}: FileQueueItemProps) {
  const isFinalizing = item.status === 'finalizing'
  const isDuplicate = item.status === 'duplicate'

  return (
    <Paper component='li' withBorder p='sm' radius='md' className='cyber-card'>
      <Group wrap='nowrap' align='flex-start' gap='sm'>
        <Thumbnail item={item} />

        <Stack gap={6} style={{ flex: 1, minWidth: 0 }}>
          <Group justify='space-between' wrap='nowrap'>
            <Text fw={500} truncate>
              {item.name}
            </Text>
            <Text size='sm' c='dimmed'>
              {formatSize(item.size)}
            </Text>
          </Group>

          <Group gap='sm' align='center' wrap='nowrap'>
            <Progress
              value={isFinalizing ? 100 : item.progress}
              color={STATUS_COLOR[item.status]}
              striped={isFinalizing}
              animated={isFinalizing}
              flex={1}
              classNames={{ section: 'cyber-progress-section' }}
            />
            <Badge color={STATUS_COLOR[item.status]} variant='light'>
              {STATUS_LABEL[item.status]}
            </Badge>
          </Group>

          {item.status === 'error' && (
            <Text c='red' size='sm'>
              {item.error?.message}
            </Text>
          )}
          {isDuplicate && (
            <Stack gap={2}>
              <Text c='yellow' size='sm'>
                A file with this name may already be in the media library:
              </Text>
              {item.duplicateMatches.map((match) => (
                <Anchor
                  key={match.id}
                  href={match.sourceUrl}
                  target='_blank'
                  rel='noreferrer'
                  size='sm'
                >
                  {match.title}
                </Anchor>
              ))}
            </Stack>
          )}
          {item.status === 'success' && item.result?.sourceUrl && (
            <Anchor
              href={item.result.sourceUrl}
              target='_blank'
              rel='noreferrer'
              size='sm'
              display='inline-block'
            >
              View uploaded file
            </Anchor>
          )}

          <Group gap='xs'>
            {item.status === 'error' && (
              <Button
                size='xs'
                variant='light'
                onClick={() => onRetry(item.id)}
              >
                Retry
              </Button>
            )}
            {isDuplicate && (
              <Button
                size='xs'
                variant='light'
                color='yellow'
                onClick={() => onConfirm(item.id)}
              >
                Upload anyway
              </Button>
            )}
            <Button
              size='xs'
              variant='subtle'
              color='red'
              onClick={() => onRemove(item.id)}
            >
              {isDuplicate ? 'Cancel' : 'Remove'}
            </Button>
          </Group>
        </Stack>
      </Group>
    </Paper>
  )
}
