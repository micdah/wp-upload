import { Paper, Group, Stack, Text, Progress, Badge, Button, Anchor, Image, Center } from '@mantine/core';

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileExtension(name) {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toUpperCase();
}

const STATUS_LABEL = {
  queued: 'Queued',
  uploading: 'Uploading',
  finalizing: 'Finalizing…',
  success: 'Uploaded',
  error: 'Failed',
};

const STATUS_COLOR = {
  queued: 'gray',
  uploading: 'blue',
  finalizing: 'blue',
  success: 'green',
  error: 'red',
};

function Thumbnail({ item }) {
  if (item.previewUrl) {
    return <Image src={item.previewUrl} w={48} h={48} radius="sm" fit="cover" alt="" />;
  }

  return (
    <Center w={48} h={48} bg="gray.1" style={{ borderRadius: 6, flexShrink: 0 }}>
      <Text size="xs" c="dimmed" fw={600}>
        {fileExtension(item.name).slice(0, 4)}
      </Text>
    </Center>
  );
}

export function FileQueueItem({ item, onRetry, onRemove }) {
  const isFinalizing = item.status === 'finalizing';

  return (
    <Paper component="li" withBorder p="sm" radius="md">
      <Group wrap="nowrap" align="flex-start" gap="sm">
        <Thumbnail item={item} />

        <Stack gap={6} style={{ flex: 1, minWidth: 0 }}>
          <Group justify="space-between" wrap="nowrap">
            <Text fw={500} truncate>
              {item.name}
            </Text>
            <Text size="sm" c="dimmed">
              {formatSize(item.size)}
            </Text>
          </Group>

          <Group gap="sm" align="center" wrap="nowrap">
            <Progress
              value={isFinalizing ? 100 : item.progress}
              color={STATUS_COLOR[item.status]}
              striped={isFinalizing}
              animated={isFinalizing}
              flex={1}
            />
            <Badge color={STATUS_COLOR[item.status]} variant="light">
              {STATUS_LABEL[item.status]}
            </Badge>
          </Group>

          {item.status === 'error' && (
            <Text c="red" size="sm">
              {item.error?.message}
            </Text>
          )}
          {item.status === 'success' && item.result?.sourceUrl && (
            <Anchor href={item.result.sourceUrl} target="_blank" rel="noreferrer" size="sm" display="inline-block">
              View uploaded file
            </Anchor>
          )}

          <Group gap="xs">
            {item.status === 'error' && (
              <Button size="xs" variant="light" onClick={() => onRetry(item.id)}>
                Retry
              </Button>
            )}
            <Button size="xs" variant="subtle" color="red" onClick={() => onRemove(item.id)}>
              Remove
            </Button>
          </Group>
        </Stack>
      </Group>
    </Paper>
  );
}
