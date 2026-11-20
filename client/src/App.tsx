import { Center, Container, Stack, Text, Title } from '@mantine/core'
import { useState } from 'react'
import {
  ConnectionStatus,
  STATUS_BAR_HEIGHT,
  type StatusResponse,
} from './components/ConnectionStatus'
import { Dropzone } from './components/Dropzone'
import { FileQueue } from './components/FileQueue'
import { FolderPicker } from './components/FolderPicker'
import { NyanUnicorn } from './components/NyanUnicorn'
import { SummaryBar } from './components/SummaryBar'
import { useUploadQueue } from './hooks/useUploadQueue'
import type { SelectedFolder } from './lib/folderClient'

export default function App() {
  const {
    items,
    concurrency,
    addFiles,
    confirmUpload,
    retry,
    retryAllFailed,
    removeFile,
    clearCompleted,
    setConcurrency,
  } = useUploadQueue()
  const [maxFileSizeMb, setMaxFileSizeMb] = useState<number | null>(null)
  const [serverConcurrency, setServerConcurrency] = useState<number | null>(
    null,
  )
  const [filebirdEnabled, setFilebirdEnabled] = useState(false)
  const [folder, setFolder] = useState<SelectedFolder | null>(null)

  const handleStatus = (status: StatusResponse) => {
    setMaxFileSizeMb(status.maxFileSizeMb)
    setServerConcurrency(status.uploadConcurrency)
    setFilebirdEnabled(status.filebirdEnabled)
    if (status.uploadConcurrency && concurrency > status.uploadConcurrency) {
      setConcurrency(status.uploadConcurrency)
    }
  }

  return (
    <>
      <Container size='sm' pt='xl' pb={STATUS_BAR_HEIGHT + 24}>
        <Stack gap='lg'>
          <Stack gap={4} align='center'>
            <Center>
              <NyanUnicorn size={240} />
            </Center>
            <Title order={1} size='h3' c='neon.3' className='cyber-title'>
              WordPress Media Uploader
            </Title>
          </Stack>

          <Stack gap={4}>
            <Dropzone
              onFiles={(files) =>
                addFiles(files, filebirdEnabled ? folder : null)
              }
            />
            {maxFileSizeMb && (
              <Text size='xs' c='dimmed'>
                Maximum file size: {maxFileSizeMb} MB per file.
              </Text>
            )}
          </Stack>

          {filebirdEnabled && (
            <FolderPicker value={folder} onChange={setFolder} />
          )}

          <SummaryBar
            items={items}
            concurrency={concurrency}
            serverConcurrency={serverConcurrency}
            onConcurrencyChange={setConcurrency}
            onRetryAllFailed={retryAllFailed}
            onClearCompleted={clearCompleted}
          />

          <FileQueue
            items={items}
            onConfirm={confirmUpload}
            onRetry={retry}
            onRemove={removeFile}
          />
        </Stack>
      </Container>

      <ConnectionStatus onStatus={handleStatus} />
    </>
  )
}
