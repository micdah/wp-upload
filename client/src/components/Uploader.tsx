import { Box, Button, Container, Stack, Text } from '@mantine/core'
import { useState } from 'react'
import { type UploadStatus, useUploadQueue } from '../hooks/useUploadQueue'
import type { SelectedFolder } from '../lib/folderClient'
import { AppHeader } from './AppHeader'
import {
  ConnectionStatus,
  STATUS_BAR_HEIGHT,
  type StatusResponse,
} from './ConnectionStatus'
import { Dropzone } from './Dropzone'
import { FileQueue } from './FileQueue'
import { FolderPicker } from './FolderPicker'
import { SummaryBar } from './SummaryBar'

const IN_PROGRESS: ReadonlySet<UploadStatus> = new Set([
  'checking',
  'queued',
  'uploading',
  'finalizing',
])

interface UploaderProps {
  onLogout: () => void
}

// The app itself, shown once logged in.
export function Uploader({ onLogout }: UploaderProps) {
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

  // Logging out drops the queue, so don't do it by accident mid-upload.
  // Uploads the server already has keep going in WordPress regardless.
  const handleLogout = () => {
    const busy = items.some((item) => IN_PROGRESS.has(item.status))
    if (
      busy &&
      !window.confirm(
        'Uploads are still in progress and will disappear from this list. Log out anyway?',
      )
    ) {
      return
    }
    onLogout()
  }

  return (
    <>
      <Container size='sm' pt='xl' pb={STATUS_BAR_HEIGHT + 24} pos='relative'>
        <Box pos='absolute' top={12} right={16}>
          <Button variant='subtle' size='compact-sm' onClick={handleLogout}>
            Log out
          </Button>
        </Box>
        <Stack gap='lg'>
          <AppHeader />

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
