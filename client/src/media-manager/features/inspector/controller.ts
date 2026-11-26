// What the inspector's fields do with the autosave state machine
// (autosave.ts): typing, committing through the data layer, reverting,
// Retry, and telling the user (live region, toast). Every function takes
// the item id the text was typed for, never "the current target", so a
// commit after the selection moved still writes the right item. A logout
// clears it all, and a save that settles afterwards changes nothing.

import type { QueryClient } from '@tanstack/react-query'
import { isLibraryError } from '../../core/data/errors'
import { saveItemMeta } from '../../core/data/inspector'
import { cachedItem } from '../../core/data/items'
import { can } from '../../core/perms'
import { announce } from '../../core/ui/announce'
import { toast } from '../../core/ui/toast'
import {
  beginSave,
  canRevert,
  type Entry,
  edit,
  expireSaved,
  revert,
  SAVED_VISIBLE_MS,
  saveFailed,
  saveRefused,
  saveSucceeded,
} from './autosave'
import { inspectorSession, onPanelReset } from './bridge'
import {
  type FieldName,
  fieldEntry,
  fieldKey,
  inspectorStore,
  isFieldMounted,
} from './store'

export const FIELD_LABELS: Record<FieldName, string> = {
  title: 'Title',
  alt: 'Alt text',
  caption: 'Caption',
  description: 'Description',
}

/**
 * The item's saved value of a field, as the cache holds it. Caption and
 * description exist on full items only; the panel shows those fields only
 * once the full item is loaded.
 */
export function currentValue(
  queryClient: QueryClient,
  id: number,
  field: FieldName,
): string {
  const item = cachedItem(queryClient, id) as
    | Partial<Record<FieldName, string>>
    | null
    | undefined
  return item?.[field] ?? ''
}

function update(key: string, change: (entry: Entry) => Entry): void {
  inspectorStore.getState().updateField(key, change)
}

/** The user typed in a field. */
export function editField(
  id: number,
  field: FieldName,
  value: string,
  current: string,
): void {
  update(fieldKey(id, field), (entry) => edit(entry, value, current))
}

/**
 * Esc: drops unsaved text, an error, or typing during a save (back to the
 * text being saved). Returns whether there was any.
 */
export function revertField(id: number, field: FieldName): boolean {
  const key = fieldKey(id, field)
  if (!canRevert(fieldEntry(key))) {
    return false
  }
  update(key, revert)
  announce(`${FIELD_LABELS[field]} reverted`)
  return true
}

/** Why a save failed, as the middle of "Not saved — … Your text is kept here." */
function failureReason(error: unknown): string {
  if (isLibraryError(error)) {
    if (error.kind === 'connectivity') {
      return "WordPress didn't respond"
    }
    return error.message.replace(/\.$/, '') || 'The server refused the change'
  }
  return 'Something went wrong'
}

const savedTimers = new Map<string, ReturnType<typeof setTimeout>>()

/** Lets "✓ Saved" show for a moment, then the field is clean again. */
function scheduleSavedExpiry(key: string): void {
  clearTimeout(savedTimers.get(key))
  savedTimers.set(
    key,
    setTimeout(() => {
      savedTimers.delete(key)
      update(key, expireSaved)
    }, SAVED_VISIBLE_MS),
  )
}

// A logout: the drafts, errors and "✓ Saved" labels belong to the session
// that ended.
onPanelReset(() => {
  for (const timer of savedTimers.values()) {
    clearTimeout(timer)
  }
  savedTimers.clear()
  inspectorStore.setState({ fields: {}, progress: {} })
})

type SavedListener = (
  queryClient: QueryClient,
  id: number,
  field: FieldName,
) => void

const savedListeners = new Set<SavedListener>()

/**
 * Runs after each successful save of a field: one item's, or a batch's
 * (called once, with its first changed id). The alt pass listens.
 */
export function onFieldSaved(listener: SavedListener): () => void {
  savedListeners.add(listener)
  return () => {
    savedListeners.delete(listener)
  }
}

/** Tells the listeners a field was saved (also used by batch.ts). */
export function notifyFieldSaved(
  queryClient: QueryClient,
  id: number,
  field: FieldName,
): void {
  for (const listener of [...savedListeners]) {
    listener(queryClient, id, field)
  }
}

/**
 * Commits a field's text to its item: blur, Enter, Ctrl/Cmd+Enter, Retry,
 * and leaving the item with unsaved text. Resolves when the save settled
 * (it never rejects; a failure is the field's error state).
 */
export async function commitField(
  queryClient: QueryClient,
  id: number,
  field: FieldName,
): Promise<void> {
  const key = fieldKey(id, field)
  const session = inspectorSession()
  const current = currentValue(queryClient, id, field)
  const begin = beginSave(fieldEntry(key), current)
  if (begin.kind !== 'send') {
    update(key, () => begin.entry)
    return
  }
  const item = cachedItem(queryClient, id)
  const verdict =
    item === null
      ? { ok: false as const, reason: 'This item no longer exists' }
      : can('edit-meta', item ?? undefined)
  if (!verdict.ok) {
    // Never send a write the user may not make; keep the text.
    update(key, (entry) => saveRefused(entry, verdict.reason))
    announce(`${FIELD_LABELS[field]} not saved. ${verdict.reason}.`)
    if (!isFieldMounted(key)) {
      notifyElsewhere(queryClient, id, field)
    }
    return
  }
  update(key, () => begin.entry)
  try {
    await saveItemMeta(queryClient, id, { [field]: begin.value })
    if (inspectorSession() !== session) {
      return
    }
    update(key, (entry) => saveSucceeded(entry, begin.value))
    announce(`${FIELD_LABELS[field]} saved`)
    notifyFieldSaved(queryClient, id, field)
    if (fieldEntry(key)?.phase === 'saved') {
      scheduleSavedExpiry(key)
    }
  } catch (error) {
    if (inspectorSession() !== session) {
      return
    }
    const reason = failureReason(error)
    update(key, (entry) => saveFailed(entry, begin.value, reason))
    announce(`${FIELD_LABELS[field]} not saved. ${reason}. Your text is kept.`)
    if (!isFieldMounted(key)) {
      notifyElsewhere(queryClient, id, field)
    }
    return
  }
  const after = fieldEntry(key)
  if (after?.queued && after.phase === 'dirty') {
    await commitField(queryClient, id, field)
  }
}

/** The user has moved on: a toast says which item's text didn't save. */
function notifyElsewhere(
  queryClient: QueryClient,
  id: number,
  field: FieldName,
): void {
  const title = cachedItem(queryClient, id)?.title || `item ${id}`
  toast({
    tone: 'error',
    message: `${FIELD_LABELS[field]} for “${title}” wasn't saved`,
    action: {
      label: 'Retry',
      run: () => {
        void commitField(queryClient, id, field)
      },
    },
  })
}

/** Leaving a field's item (unmount): unsaved typing is committed to it. */
export function commitOnLeave(
  queryClient: QueryClient,
  id: number,
  field: FieldName,
): void {
  if (fieldEntry(fieldKey(id, field))?.phase === 'dirty') {
    void commitField(queryClient, id, field)
  }
}
