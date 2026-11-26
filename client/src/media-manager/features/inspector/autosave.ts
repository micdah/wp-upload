// The autosave state machine of one inspector field (inspector.md §3), as
// pure functions over its entry. The feature store keeps one entry per
// `<item id>:<field>`; no entry means the field is clean (it shows the
// item's own value).
//
//   clean ──type──▶ dirty ──commit──▶ saving ──ok──▶ saved ──1.8 s──▶ clean
//                    ▲  ◀──Esc (revert)──┘  │
//                    │                      └──fail──▶ error (text kept)
//                    └────────────type──────────────────┘   │
//                                          Retry / commit ◀─┘
//
// The draft is the text in the field. It stays while the request runs (a
// refetch during the save can't flicker the old value back), and after a
// failure (so Retry has something to send). Typing while a save runs is
// kept: the save's outcome no longer clears it, and a commit meanwhile is
// queued for after the save settles. Esc while saving drops that newer
// typing (and the queued commit), back to the text being saved.

export type FieldPhase = 'dirty' | 'saving' | 'saved' | 'error'

export interface FieldEntry {
  /** The text in the field; null shows the item's value. */
  draft: string | null
  phase: FieldPhase
  /** What the running save sends (phase `saving`). */
  sending: string | null
  /** A commit arrived while saving: commit again once it settles. */
  queued: boolean
  /** Why the last save failed (phase `error`). */
  error: string | null
}

/** Absent = clean. */
export type Entry = FieldEntry | undefined

/** What the label row shows. */
export type FieldStatus = 'unsaved' | 'saving' | 'saved' | 'error' | null

/** The value the field shows. */
export function displayValue(entry: Entry, current: string): string {
  return entry?.draft ?? current
}

export function statusOf(entry: Entry): FieldStatus {
  switch (entry?.phase) {
    case 'dirty':
      return 'unsaved'
    case 'saving':
      return 'saving'
    case 'saved':
      return 'saved'
    case 'error':
      return 'error'
    default:
      return null
  }
}

/** The user typed `value`; `current` is the item's value. */
export function edit(entry: Entry, value: string, current: string): Entry {
  if (entry?.phase === 'saving') {
    return { ...entry, draft: value }
  }
  if (value === current) {
    return undefined
  }
  return {
    draft: value,
    phase: 'dirty',
    sending: null,
    queued: false,
    error: null,
  }
}

/** Unsaved text (or a failed save) that a commit would send. */
export function hasUnsavedText(entry: Entry): boolean {
  return entry?.phase === 'dirty' || entry?.phase === 'error'
}

/** Text that Esc would drop: unsaved text, an error, or typing during a save. */
export function canRevert(entry: Entry): boolean {
  if (entry?.phase === 'saving') {
    return entry.draft !== null && entry.draft !== entry.sending
  }
  return hasUnsavedText(entry)
}

export type BeginResult =
  /** Send `value`; the entry is now `saving`. */
  | { kind: 'send'; entry: FieldEntry; value: string }
  /** A save is running; this commit runs after it. */
  | { kind: 'queued'; entry: FieldEntry }
  /** Nothing to send (no draft, or it equals the item's value). */
  | { kind: 'nothing'; entry: Entry }

/** A commit (blur, Enter, Ctrl/Cmd+Enter, Retry, leaving the item). */
export function beginSave(entry: Entry, current: string): BeginResult {
  if (entry === undefined) {
    return { kind: 'nothing', entry }
  }
  if (entry.phase === 'saving') {
    return { kind: 'queued', entry: { ...entry, queued: true } }
  }
  if (entry.phase === 'saved') {
    // Nothing typed since the save: "✓ Saved" stays until it expires.
    return { kind: 'nothing', entry }
  }
  if (entry.draft === null || entry.draft === current) {
    // Retyped the saved value, or an error whose text the server now holds.
    return { kind: 'nothing', entry: undefined }
  }
  const value = entry.draft
  return {
    kind: 'send',
    value,
    entry: {
      draft: value,
      phase: 'saving',
      sending: value,
      queued: false,
      error: null,
    },
  }
}

/** The save of `sent` succeeded. */
export function saveSucceeded(entry: Entry, sent: string): Entry {
  if (entry === undefined) {
    return undefined
  }
  const untouched = entry.draft === null || entry.draft === sent
  if (untouched) {
    return {
      draft: null,
      phase: 'saved',
      sending: null,
      queued: false,
      error: null,
    }
  }
  // Typed on while it saved: those keystrokes are unsaved now.
  return { ...entry, phase: 'dirty', sending: null, error: null }
}

/** The save of `sent` failed; the field keeps its text for Retry. */
export function saveFailed(entry: Entry, sent: string, error: string): Entry {
  return {
    draft: entry?.draft ?? sent,
    phase: 'error',
    sending: null,
    queued: false,
    error,
  }
}

/** A commit was refused before sending (no permission, offline). */
export function saveRefused(entry: Entry, error: string): Entry {
  if (entry === undefined || entry.draft === null) {
    return entry
  }
  return { ...entry, phase: 'error', sending: null, queued: false, error }
}

/**
 * Esc: drop the unsaved text (or the error). A running save goes on, and the
 * field shows the text it sends; typing since and a queued commit are gone.
 */
export function revert(entry: Entry): Entry {
  if (entry?.phase === 'saving') {
    return { ...entry, draft: entry.sending, queued: false }
  }
  return undefined
}

/** The "✓ Saved" label has shown long enough. */
export function expireSaved(entry: Entry): Entry {
  return entry?.phase === 'saved' ? undefined : entry
}

/** How long "✓ Saved" stays (inspector.md §3). */
export const SAVED_VISIBLE_MS = 1800
