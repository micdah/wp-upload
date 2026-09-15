import { Group, Text, Select, Button } from '@mantine/core';

const CONCURRENCY_OPTIONS = ['1', '2', '3', '4', '5', '6'];

export function SummaryBar({ items, concurrency, serverConcurrency, onConcurrencyChange, onRetryAllFailed, onClearCompleted }) {
  const counts = items.reduce(
    (acc, item) => {
      acc[item.status] = (acc[item.status] || 0) + 1;
      return acc;
    },
    { queued: 0, uploading: 0, finalizing: 0, success: 0, error: 0 }
  );

  return (
    <Group justify="space-between" wrap="wrap" gap="md">
      <Group gap="md" c="dimmed">
        <Text size="sm">{items.length} total</Text>
        <Text size="sm">{counts.success} uploaded</Text>
        <Text size="sm">{counts.error} failed</Text>
        <Text size="sm">{counts.queued + counts.uploading + counts.finalizing} in progress</Text>
      </Group>

      <Group gap="sm" align="center" wrap="wrap">
        <Group gap={6} align="center">
          <Text size="sm">Parallel uploads:</Text>
          <Select
            value={String(concurrency)}
            onChange={(value) => onConcurrencyChange(Number(value))}
            data={CONCURRENCY_OPTIONS}
            w={70}
            allowDeselect={false}
          />
          {serverConcurrency != null && (
            <Text size="xs" c="dimmed">
              (server allows up to {serverConcurrency} at once)
            </Text>
          )}
        </Group>
        <Button size="xs" variant="light" disabled={counts.error === 0} onClick={onRetryAllFailed}>
          Retry all failed
        </Button>
        <Button size="xs" variant="default" disabled={counts.success === 0} onClick={onClearCompleted}>
          Clear completed
        </Button>
      </Group>
    </Group>
  );
}
