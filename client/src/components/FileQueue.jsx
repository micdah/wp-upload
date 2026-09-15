import { FileQueueItem } from './FileQueueItem';

export function FileQueue({ items, onRetry, onRemove }) {
  if (items.length === 0) {
    return <p className="file-queue-empty">No files added yet.</p>;
  }

  return (
    <ul className="file-queue">
      {items.map((item) => (
        <FileQueueItem key={item.id} item={item} onRetry={onRetry} onRemove={onRemove} />
      ))}
    </ul>
  );
}
