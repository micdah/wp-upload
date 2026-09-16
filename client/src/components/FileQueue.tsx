import { Stack, Text } from '@mantine/core';
import { FileQueueItem } from './FileQueueItem';
import type { FileEntry } from '../hooks/useUploadQueue';

interface FileQueueProps {
  items: FileEntry[];
  onRetry: (id: string) => void;
  onRemove: (id: string) => void;
}

export function FileQueue({ items, onRetry, onRemove }: FileQueueProps) {
  if (items.length === 0) {
    return (
      <Text c="dimmed" size="sm">
        No files added yet.
      </Text>
    );
  }

  return (
    <Stack gap="sm" component="ul" role="list" p={0} style={{ listStyle: 'none' }}>
      {items.map((item) => (
        <FileQueueItem key={item.id} item={item} onRetry={onRetry} onRemove={onRemove} />
      ))}
    </Stack>
  );
}
