// The undo registry behind toasts (system.md §9 request 4): undoable toasts
// register an entry, so Ctrl/Cmd+Z undoes the latest one without relying on
// button labels. An entry lives as long as its toast is on screen.

export interface UndoEntry {
  /** The toast id. */
  key: string
  /** What is undone, e.g. "Move 3 items to Holidays". */
  label: string
  run: () => unknown
}

export interface UndoRegistry {
  push(entry: UndoEntry): void
  remove(key: string): void
  /** Removes and returns the newest entry, or null. */
  takeLast(): UndoEntry | null
  /** Removes and returns the entry for `key`, or null (already undone or gone). */
  take(key: string): UndoEntry | null
  size(): number
}

export function createUndoRegistry(): UndoRegistry {
  const entries: UndoEntry[] = []
  function indexOf(key: string): number {
    return entries.findIndex((entry) => entry.key === key)
  }
  return {
    push(entry) {
      const existing = indexOf(entry.key)
      if (existing !== -1) {
        entries.splice(existing, 1)
      }
      entries.push(entry)
    },
    remove(key) {
      const index = indexOf(key)
      if (index !== -1) {
        entries.splice(index, 1)
      }
    },
    takeLast() {
      return entries.pop() ?? null
    },
    take(key) {
      const index = indexOf(key)
      if (index === -1) {
        return null
      }
      return entries.splice(index, 1)[0] ?? null
    },
    size() {
      return entries.length
    },
  }
}
