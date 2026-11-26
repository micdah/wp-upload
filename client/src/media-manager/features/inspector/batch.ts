// Batch editing (inspector.md §2 "Several items", §9): one field edits the
// same text into every selected item. It reuses the one-item autosave state
// machine (autosave.ts) with the items' shared value as "current":
//
// - values that differ are **Mixed**: the field starts empty;
// - an empty field never commits, Mixed or not ("clear on all" isn't in
//   v1, §9);
// - alt text goes to image-like items only (kinds the client doesn't know
//   yet are loaded first, so a large selection reaches every image);
// - Description can **Replace** or **Append** (a new paragraph; the field
//   clears after the save);
// - an Author's mixed selection writes their own items only (D9);
// - the write is client-chunked with progress (D24), and the toast's Undo
//   puts every item's `previous` value back.
//
// Field keys are `batch:<ids key>:<field>`; the ids behind a key are kept
// here, so a half-typed edit commits to the items it was typed for even
// after the selection moved on (§9).

import type { QueryClient } from '@tanstack/react-query'
import type {
  LibraryItemFull,
  LibraryItemTile,
} from '../../../../../shared/library-api'
import { getCurrentCollection } from '../../core/collection/hooks'
import { isLibraryError } from '../../core/data/errors'
import {
  type BatchUndo,
  type DescriptionMode,
  saveBatchMeta,
  undoBatchMeta,
} from '../../core/data/inspector'
import {
  cachedItem,
  chunkIds,
  itemChunkQueryOptions,
} from '../../core/data/items'
import { can } from '../../core/perms'
import { announce, plural } from '../../core/ui/announce'
import { toast } from '../../core/ui/toast'
import {
  beginSave,
  type Entry,
  expireSaved,
  SAVED_VISIBLE_MS,
  saveFailed,
  saveRefused,
  saveSucceeded,
} from './autosave'
import { inspectorSession, onPanelReset } from './bridge'
import { FIELD_LABELS, notifyFieldSaved } from './controller'
import { isImageLike } from './format'
import { type FieldName, fieldEntry, inspectorStore } from './store'

type AnyItem = LibraryItemTile | LibraryItemFull

/**
 * A short, stable key for a set of ids (FNV-1a over them sorted, plus the
 * count). Order doesn't count: a filter that only reorders the selection
 * (hidden ones go last) is still the same batch, and its fields stay.
 */
export function batchKey(ids: readonly number[]): string {
  let hash = 0x811c9dc5
  for (const id of [...ids].sort((a, b) => a - b)) {
    hash ^= id
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `${ids.length}-${hash.toString(36)}`
}

export function batchFieldKey(key: string, field: FieldName): string {
  return `batch:${key}:${field}`
}

/** Full items loaded for the values (10 requests); beyond, values are unknown. */
export const BATCH_HYDRATE_LIMIT = 1000

const contexts = new Map<string, readonly number[]>()

/** The panel shows a batch: remember its ids under its key. */
export function registerBatch(key: string, ids: readonly number[]): void {
  contexts.set(key, ids)
}

/** Replace or Append: the one value the toggle shows and commits use. */
export function descriptionMode(): DescriptionMode {
  return inspectorStore.getState().descriptionMode
}

export function setDescriptionMode(mode: DescriptionMode): void {
  inspectorStore.setState({ descriptionMode: mode })
}

/**
 * A media kind from what the client knows: the cache, or the collection
 * rows on screen. Null when neither has the item.
 */
export function knownKind(
  queryClient: QueryClient,
  id: number,
): AnyItem['kind'] | null {
  const cached = cachedItem(queryClient, id)?.kind
  if (cached) {
    return cached
  }
  const rows = getCurrentCollection()?.rows
  const index = rows ? rows.indexOf(id) : -1
  return rows && index >= 0 ? rows.kindAt(index) : null
}

/**
 * Makes every id's kind known before alt text is written (it goes to
 * image-like items only): ids neither cached nor on screen are hydrated as
 * tiles, 100 per request, so a large selection reaches every image.
 */
async function loadKinds(
  queryClient: QueryClient,
  ids: readonly number[],
): Promise<void> {
  const unknown = ids.filter((id) => knownKind(queryClient, id) === null)
  for (const chunk of chunkIds(unknown)) {
    await queryClient.fetchQuery(
      itemChunkQueryOptions(queryClient, 'tile', chunk),
    )
  }
}

/** The items a field applies to: alt text only to image-like ones. */
export function applicableIds(
  ids: readonly number[],
  field: FieldName,
  kindOf: (id: number) => AnyItem['kind'] | null,
): number[] {
  if (field !== 'alt') {
    return [...ids]
  }
  return ids.filter((id) => isImageLike(kindOf(id) ?? undefined))
}

export interface SharedValue {
  /** The value every item has, or '' when they differ (Mixed). */
  current: string
  mixed: boolean
  /** How many different values (for "Mixed — 3 different values"). */
  distinct: number
  /** Some items' values aren't loaded, so "Mixed" may be a guess. */
  partial: boolean
}

/** The items' shared value of a field (items not loaded count as unknown). */
export function sharedValue(
  ids: readonly number[],
  valueFor: (id: number) => string | undefined,
): SharedValue {
  const values = new Set<string>()
  let unknown = 0
  for (const id of ids) {
    const value = valueFor(id)
    if (value === undefined) {
      unknown += 1
    } else {
      values.add(value)
    }
  }
  const partial = unknown > 0
  if (values.size === 1 && !partial) {
    return {
      current: [...values][0] as string,
      mixed: false,
      distinct: 1,
      partial,
    }
  }
  if (values.size === 0) {
    return { current: '', mixed: partial, distinct: 0, partial }
  }
  return { current: '', mixed: true, distinct: values.size, partial }
}

function fieldValue(item: AnyItem | null | undefined, field: FieldName) {
  if (!item) {
    return undefined
  }
  const value = (item as Partial<Record<FieldName, string>>)[field]
  return typeof value === 'string' ? value : undefined
}

/**
 * What a commit compares against, from the cache at commit time. Past the
 * hydration limit the panel can't know every value, so it is Mixed.
 */
function sharedNow(
  queryClient: QueryClient,
  ids: readonly number[],
  field: FieldName,
  selected: number,
): SharedValue {
  const shared = sharedValue(ids, (id) =>
    fieldValue(cachedItem(queryClient, id), field),
  )
  return selected > BATCH_HYDRATE_LIMIT
    ? { ...shared, current: '', mixed: true, partial: true }
    : shared
}

/**
 * Splits the applicable ids by permission. Items not loaded are sent: the
 * server refuses what the user may not change, per item.
 */
export function permittedIds(
  queryClient: QueryClient,
  ids: readonly number[],
): { allowed: number[]; denied: number } {
  const allowed: number[] = []
  let denied = 0
  for (const id of ids) {
    const item = cachedItem(queryClient, id)
    if (!item || can('edit-meta', item).ok) {
      allowed.push(id)
    } else {
      denied += 1
    }
  }
  return { allowed, denied }
}

function update(key: string, change: (entry: Entry) => Entry): void {
  inspectorStore.getState().updateField(key, change)
}

const savedTimers = new Map<string, ReturnType<typeof setTimeout>>()

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

onPanelReset(() => {
  for (const timer of savedTimers.values()) {
    clearTimeout(timer)
  }
  savedTimers.clear()
  contexts.clear()
  inspectorStore.setState({ descriptionMode: 'replace' })
})

function reasonOf(error: unknown): string {
  if (isLibraryError(error)) {
    if (error.kind === 'connectivity') {
      return "WordPress didn't respond"
    }
    return error.message.replace(/\.$/, '') || 'The server refused the change'
  }
  return 'Something went wrong'
}

/** "Updated caption on 4 items", "Added to the description of 4 items". */
function doneMessage(
  field: FieldName,
  mode: DescriptionMode,
  changed: number,
): string {
  if (field === 'description' && mode === 'append') {
    return `Added a paragraph to the description of ${plural(changed, 'item')}`
  }
  return `Updated ${FIELD_LABELS[field].toLowerCase()} on ${plural(changed, 'item')}`
}

/**
 * Commits a batch field to every item it applies to (blur, Enter in Title
 * or Alt text, Ctrl/Cmd+Enter, Retry, leaving the batch). Never rejects.
 */
export async function commitBatchField(
  queryClient: QueryClient,
  key: string,
  field: FieldName,
): Promise<void> {
  const selected = contexts.get(key)
  if (!selected) {
    return
  }
  const fieldKey = batchFieldKey(key, field)
  const label = FIELD_LABELS[field]
  const mode = field === 'description' ? descriptionMode() : 'replace'
  const before = fieldEntry(fieldKey)
  // An empty batch field never writes: clearing a field on every item
  // isn't in v1 (inspector.md §9), Mixed or not. The field shows the
  // items' own value again.
  if (
    (before?.phase === 'dirty' || before?.phase === 'error') &&
    before.draft !== null &&
    before.draft.trim() === ''
  ) {
    update(fieldKey, () => undefined)
    return
  }
  if (field === 'alt' && before?.phase !== 'saving') {
    try {
      await loadKinds(queryClient, selected)
    } catch (error) {
      update(fieldKey, (entry) =>
        saveFailed(entry, entry?.draft ?? '', reasonOf(error)),
      )
      announce(`${label} not saved. ${reasonOf(error)}. Your text is kept.`)
      return
    }
  }
  const ids = applicableIds(selected, field, (id) => knownKind(queryClient, id))
  const current =
    mode === 'append'
      ? ''
      : sharedNow(queryClient, ids, field, selected.length).current
  const begin = beginSave(fieldEntry(fieldKey), current)
  if (begin.kind !== 'send') {
    update(fieldKey, () => begin.entry)
    return
  }
  const verdict = can('edit-meta')
  const { allowed } = permittedIds(queryClient, ids)
  if (!verdict.ok || allowed.length === 0) {
    const reason = verdict.ok
      ? 'You can’t edit any of these items'
      : verdict.reason
    update(fieldKey, (entry) => saveRefused(entry, reason))
    announce(`${label} not saved. ${reason}.`)
    return
  }
  const session = inspectorSession()
  const store = inspectorStore.getState()
  update(fieldKey, () => begin.entry)
  store.setProgress(fieldKey, { done: 0, total: allowed.length })
  const outcome = await saveBatchMeta(
    queryClient,
    allowed,
    { field, value: begin.value, mode },
    {
      onProgress: (progress) => {
        if (inspectorSession() === session) {
          inspectorStore.getState().setProgress(fieldKey, {
            done: progress.done,
            total: progress.total,
          })
        }
      },
    },
  )
  if (inspectorSession() !== session) {
    return
  }
  inspectorStore.getState().setProgress(fieldKey, null)
  const changed = outcome.changed.length
  if (changed === 0) {
    const reason = outcome.error
      ? reasonOf(outcome.error)
      : (outcome.failure?.replace(/\.$/, '') ?? 'Nothing was changed')
    update(fieldKey, (entry) => saveFailed(entry, begin.value, reason))
    announce(`${label} not saved. ${reason}. Your text is kept.`)
    return
  }
  update(fieldKey, (entry) =>
    mode === 'append'
      ? appendSucceeded(entry, begin.value)
      : saveSucceeded(entry, begin.value),
  )
  if (fieldEntry(fieldKey)?.phase === 'saved') {
    scheduleSavedExpiry(fieldKey)
  }
  // An emptied Missing alt view ends the pass here too (§9).
  notifyFieldSaved(queryClient, outcome.changed[0] as number, field)
  const notChanged = allowed.length - changed
  const tail =
    notChanged > 0
      ? outcome.error
        ? ` · stopped: ${reasonOf(outcome.error)}`
        : ` · ${plural(notChanged, 'item')} couldn’t be changed`
      : ''
  const undo = outcome.undo
  toast({
    tone: notChanged > 0 ? 'warning' : 'success',
    message: `${doneMessage(field, mode, changed)}${tail}`,
    undo: {
      run: () => runBatchUndo(queryClient, undo),
      done: `Restored ${FIELD_LABELS[field].toLowerCase()} on ${plural(changed, 'item')}`,
    },
  })
  // A commit made while this one ran (typing on, then Enter or blur).
  const after = fieldEntry(fieldKey)
  if (after?.queued && after.phase === 'dirty') {
    await commitBatchField(queryClient, key, field)
  }
}

/**
 * The batch toast's Undo. A partial restore rejects with the real count,
 * so the toast says "Couldn't undo: …" instead of claiming every item.
 */
export async function runBatchUndo(
  queryClient: QueryClient,
  undo: BatchUndo,
): Promise<void> {
  const reverted = await undoBatchMeta(queryClient, undo)
  const restored = reverted.changed.length
  if (restored === undo.length) {
    return
  }
  const why = reverted.error
    ? reasonOf(reverted.error)
    : (reverted.failure?.replace(/\.$/, '') ?? null)
  throw new Error(
    `only ${restored} of ${plural(undo.length, 'item')} restored${why ? ` (${why})` : ''}`,
  )
}

/**
 * An Append save succeeded. Text typed on during the save still begins
 * with what was just appended; that part is done, so only the rest stays
 * as a draft (it would otherwise be appended a second time).
 */
export function appendSucceeded(entry: Entry, sent: string): Entry {
  const after = saveSucceeded(entry, sent)
  if (after?.phase !== 'dirty' || after.draft === null) {
    return after
  }
  const rest = after.draft.startsWith(sent)
    ? after.draft.slice(sent.length).replace(/^\s+/, '')
    : after.draft
  if (rest === '') {
    return {
      draft: null,
      phase: 'saved',
      sending: null,
      queued: false,
      error: null,
    }
  }
  return { ...after, draft: rest }
}

/** Leaving a batch (unmount) with unsaved typing commits it to its items. */
export function commitBatchOnLeave(
  queryClient: QueryClient,
  key: string,
  field: FieldName,
): void {
  if (fieldEntry(batchFieldKey(key, field))?.phase === 'dirty') {
    void commitBatchField(queryClient, key, field)
  }
}
