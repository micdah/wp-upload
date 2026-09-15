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

export function FileQueueItem({ item, onRetry, onRemove }) {
  return (
    <li className={`file-item file-item-${item.status}`}>
      <div className="file-item-info">
        <span className="file-item-name">{item.name}</span>
        <span className="file-item-size">{formatSize(item.size)}</span>
      </div>

      <div className="file-item-progress">
        {item.status === 'finalizing' ? (
          <div className="progress-bar progress-indeterminate" />
        ) : (
          <div className="progress-bar">
            <div className="progress-bar-fill" style={{ width: `${item.progress}%` }} />
          </div>
        )}
        <span className="file-item-status">{STATUS_LABEL[item.status]}</span>
      </div>

      {item.status === 'error' && <div className="file-item-error">{item.error?.message}</div>}
      {item.status === 'success' && item.result?.sourceUrl && (
        <a className="file-item-link" href={item.result.sourceUrl} target="_blank" rel="noreferrer">
          View uploaded file
        </a>
      )}

      <div className="file-item-actions">
        {item.status === 'error' && (
          <button type="button" onClick={() => onRetry(item.id)}>
            Retry
          </button>
        )}
        <button type="button" onClick={() => onRemove(item.id)}>
          Remove
        </button>
      </div>
    </li>
  );
}
