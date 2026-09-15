import { useState } from 'react';
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
    <div className="app">
      <h1>WordPress Media Uploader</h1>
      <ConnectionStatus onStatus={(status) => setMaxFileSizeMb(status.maxFileSizeMb)} />

      <Dropzone onFiles={addFiles} />
      {maxFileSizeMb && <p className="hint">Maximum file size: {maxFileSizeMb} MB per file.</p>}

      <SummaryBar
        items={items}
        concurrency={concurrency}
        onConcurrencyChange={setConcurrency}
        onRetryAllFailed={retryAllFailed}
        onClearCompleted={clearCompleted}
      />

      <FileQueue items={items} onRetry={retry} onRemove={removeFile} />
    </div>
  );
}
