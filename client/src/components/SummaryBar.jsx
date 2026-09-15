export function SummaryBar({ items, concurrency, onConcurrencyChange, onRetryAllFailed, onClearCompleted }) {
  const counts = items.reduce(
    (acc, item) => {
      acc[item.status] = (acc[item.status] || 0) + 1;
      return acc;
    },
    { queued: 0, uploading: 0, finalizing: 0, success: 0, error: 0 }
  );

  return (
    <div className="summary-bar">
      <div className="summary-counts">
        <span>{items.length} total</span>
        <span>{counts.success} uploaded</span>
        <span>{counts.error} failed</span>
        <span>{counts.queued + counts.uploading + counts.finalizing} in progress</span>
      </div>

      <div className="summary-actions">
        <label>
          Parallel uploads:{' '}
          <select value={concurrency} onChange={(e) => onConcurrencyChange(Number(e.target.value))}>
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <button type="button" disabled={counts.error === 0} onClick={onRetryAllFailed}>
          Retry all failed
        </button>
        <button type="button" disabled={counts.success === 0} onClick={onClearCompleted}>
          Clear completed
        </button>
      </div>
    </div>
  );
}
