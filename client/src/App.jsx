import { useState } from 'react';
import { Container, Stack, Title, Text } from '@mantine/core';
import { ConnectionStatus } from './components/ConnectionStatus';
import { Dropzone } from './components/Dropzone';
import { FileQueue } from './components/FileQueue';
import { SummaryBar } from './components/SummaryBar';
import { useUploadQueue } from './hooks/useUploadQueue';

export default function App() {
  const { items, concurrency, addFiles, retry, retryAllFailed, removeFile, clearCompleted, setConcurrency } =
    useUploadQueue();
  const [maxFileSizeMb, setMaxFileSizeMb] = useState(null);

  return (
    <Container size="sm" py="xl">
      <Stack gap="lg">
        <Title order={1} size="h3">
          WordPress Media Uploader
        </Title>

        <ConnectionStatus onStatus={(status) => setMaxFileSizeMb(status.maxFileSizeMb)} />

        <Stack gap={4}>
          <Dropzone onFiles={addFiles} />
          {maxFileSizeMb && <Text size="xs" c="dimmed">Maximum file size: {maxFileSizeMb} MB per file.</Text>}
        </Stack>

        <SummaryBar
          items={items}
          concurrency={concurrency}
          onConcurrencyChange={setConcurrency}
          onRetryAllFailed={retryAllFailed}
          onClearCompleted={clearCompleted}
        />

        <FileQueue items={items} onRetry={retry} onRemove={removeFile} />
      </Stack>
    </Container>
  );
}
