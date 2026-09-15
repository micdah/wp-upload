import { useState } from 'react';
import { Container, Stack, Title, Text, Center } from '@mantine/core';
import { ConnectionStatus } from './components/ConnectionStatus';
import { Dropzone } from './components/Dropzone';
import { FileQueue } from './components/FileQueue';
import { SummaryBar } from './components/SummaryBar';
import { NyanUnicorn } from './components/NyanUnicorn';
import { useUploadQueue } from './hooks/useUploadQueue';

export default function App() {
  const { items, concurrency, addFiles, retry, retryAllFailed, removeFile, clearCompleted, setConcurrency } =
    useUploadQueue();
  const [maxFileSizeMb, setMaxFileSizeMb] = useState(null);

  return (
    <Container size="sm" py="xl">
      <Stack gap="lg">
        <Stack gap={4} align="center">
          <Center>
            <NyanUnicorn size={240} />
          </Center>
          <Title order={1} size="h3" c="neon.3" className="cyber-title">
            WordPress Media Uploader
          </Title>
        </Stack>

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

        <ConnectionStatus onStatus={(status) => setMaxFileSizeMb(status.maxFileSizeMb)} />
      </Stack>
    </Container>
  );
}
