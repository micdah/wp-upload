import { Paper, Group, Text, Progress, Badge, Button, Anchor } from '@mantine/core';

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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

export function FileQueueItem({ item, onRetry, onRemove }) {
  const isFinalizing = item.status === 'finalizing';

  return (
    <Paper component="li" withBorder p="sm" radius="md">
      <Group justify="space-between" wrap="nowrap" mb={6}>
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
        <Text c="red" size="sm" mt={4}>
          {item.error?.message}
        </Text>
      )}
      {item.status === 'success' && item.result?.sourceUrl && (
        <Anchor href={item.result.sourceUrl} target="_blank" rel="noreferrer" size="sm" mt={4} display="inline-block">
          View uploaded file
        </Anchor>
      )}

      <Group gap="xs" mt="xs">
        {item.status === 'error' && (
          <Button size="xs" variant="light" onClick={() => onRetry(item.id)}>
            Retry
          </Button>
        )}
        <Button size="xs" variant="subtle" color="red" onClick={() => onRemove(item.id)}>
          Remove
        </Button>
      </Group>
    </Paper>
  );
}
