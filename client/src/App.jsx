import { useState } from 'react';
import { Container, Stack, Title, Text, Center } from '@mantine/core';
import { ConnectionStatus, STATUS_BAR_HEIGHT } from './components/ConnectionStatus';
import { Dropzone } from './components/Dropzone';
import { FileQueue } from './components/FileQueue';
import { SummaryBar } from './components/SummaryBar';
import { NyanUnicorn } from './components/NyanUnicorn';
import { useUploadQueue } from './hooks/useUploadQueue';

export default function App() {
  const { items, concurrency, addFiles, retry, retryAllFailed, removeFile, clearCompleted, setConcurrency } =
    useUploadQueue();
  const [maxFileSizeMb, setMaxFileSizeMb] = useState(null);
  const [serverConcurrency, setServerConcurrency] = useState(null);

  return (
    <>
      <Container size="sm" pt="xl" pb={STATUS_BAR_HEIGHT + 24}>
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
            serverConcurrency={serverConcurrency}
            onConcurrencyChange={setConcurrency}
            onRetryAllFailed={retryAllFailed}
            onClearCompleted={clearCompleted}
          />

          <FileQueue items={items} onRetry={retry} onRemove={removeFile} />
        </Stack>
      </Container>

      <ConnectionStatus
        onStatus={(status) => {
          setMaxFileSizeMb(status.maxFileSizeMb);
          setServerConcurrency(status.uploadConcurrency);
          if (status.uploadConcurrency && concurrency > status.uploadConcurrency) {
            setConcurrency(status.uploadConcurrency);
          }
        }}
      />
    </>
  );
}
