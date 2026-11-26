// The Info panel for several items (inspector.md §2 "Several items", §7):
// a strip of up to six thumbnails, "Editing N items", the rule stated once,
// and the batch fields (batch.ts) — Mixed values with a dashed edge, alt
// text for image-like items only, Description with Replace | Append. An
// Author's mixed selection edits their own items only; all foreign: read
// only. D33: the panel says when filters hide some of the selection.

import { Textarea, TextInput, UnstyledButton } from '@mantine/core'
import { useQueryClient } from '@tanstack/react-query'
import {
  type ChangeEvent,
  type KeyboardEvent,
  useEffect,
  useId,
  useMemo,
} from 'react'
import type {
  LibraryItemFull,
  MediaKind,
} from '../../../../../shared/library-api'
import { useCollection } from '../../core/collection/hooks'
import { pictureFor } from '../../core/collection/renditions'
import type { DescriptionMode } from '../../core/data/inspector'
import { chunkIds, useItemChunks } from '../../core/data/items'
import { useCan } from '../../core/perms'
import { coreStore } from '../../core/state'
import { plural } from '../../core/ui/announce'
import { FileIcon, LockIcon, NoticeIcon } from '../../core/ui/icons'
import { displayValue, edit, revert, statusOf } from './autosave'
import {
  applicableIds,
  BATCH_HYDRATE_LIMIT,
  batchFieldKey,
  batchKey,
  commitBatchField,
  commitBatchOnLeave,
  registerBatch,
  setDescriptionMode,
  sharedValue,
} from './batch'
import { bridgeStore, useBridge } from './bridge'
import { FIELD_LABELS } from './controller'
import { formatBytes } from './format'
import classes from './Inspector.module.css'
import { BatchActions } from './info'
import { FieldStatus, isSingleLine } from './MetaField'
import { BatchAltWarning } from './Summary'
import { type FieldName, inspectorStore, useInspector } from './store'

const STRIP_SIZE = 6

export function BatchPanel({
  ids,
  hidden,
}: {
  ids: readonly number[]
  hidden: number
}) {
  const key = useMemo(() => batchKey(ids), [ids])
  // Before the fields render: a blur commits through it at once.
  registerBatch(key, ids)
  const chunks = useMemo(
    () => chunkIds(ids.slice(0, BATCH_HYDRATE_LIMIT)),
    [ids],
  )
  const hydrated = useItemChunks(chunks, 'full')
  const { rows } = useCollection()
  const items = hydrated.items
  // Kinds from the loaded items, else from the collection rows on screen.
  const kindOf = (id: number): MediaKind | null => {
    const kind = items.get(id)?.kind
    if (kind) {
      return kind
    }
    const index = rows.indexOf(id)
    return index >= 0 ? rows.kindAt(index) : null
  }
  const count = ids.length
  // Past the limit, values and permissions are known for the first 1,000
  // only: fields show "Mixed values" and the panel says what it counted.
  const over = count > BATCH_HYDRATE_LIMIT
  const loaded = [...items.values()]
  const bytes = loaded.reduce((sum, item) => sum + (item.filesize ?? 0), 0)
  const imageIds = applicableIds(ids, 'alt', kindOf)
  const unknownKinds = ids.filter((id) => kindOf(id) === null).length
  const others = count - imageIds.length - unknownKinds
  const missingAlt = imageIds.filter(
    (id) => items.get(id)?.alt.trim() === '',
  ).length
  // Ownership, not can(): offline is said once, below, not per item.
  const editable = loaded.filter((item) => item.perms.edit).length
  const foreign = loaded.length - editable
  const deletable = over || loaded.some((item) => item.perms.delete)
  const verdict = useCan('edit-meta')
  const allForeign = !over && loaded.length > 0 && foreign === loaded.length
  const locked = allForeign
  const refused = !verdict.ok
  const shared = (field: FieldName, among: readonly number[] = ids) => {
    const value = sharedValue(among, (id) => items.get(id)?.[field])
    return over ? { ...value, current: '', mixed: true, partial: true } : value
  }

  return (
    <div className={classes.single}>
      <Strip ids={ids} items={items} />
      <div>
        <h3 className={classes.heading}>
          Editing {count.toLocaleString('en')} items
        </h3>
        <p className={classes.sub}>
          {[
            !over && bytes > 0 ? formatBytes(bytes) : null,
            describeKinds(imageIds.length, others, unknownKinds),
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </div>
      <p className={classes.rule}>
        <NoticeIcon size={14} aria-hidden className={classes.ruleIcon} />
        <span>
          Edits apply to all {count.toLocaleString('en')} items
          {hidden > 0
            ? `, ${hidden.toLocaleString('en')} of them hidden by the filters`
            : ''}
          . Fields left empty stay as they are.
          {over &&
            ` Values and permissions are shown for the first ${BATCH_HYDRATE_LIMIT.toLocaleString('en')} items.`}
        </span>
      </p>
      {allForeign ? (
        <p className={classes.lock} data-testid='lock-notice'>
          <LockIcon size={16} aria-hidden className={classes.lockIcon} />
          <span>
            You can view but not edit media uploaded by others (Author role).
          </span>
        </p>
      ) : (
        foreign > 0 && (
          <p className={classes.lock} data-testid='partition-notice'>
            <LockIcon size={16} aria-hidden className={classes.lockIcon} />
            <span>
              {over
                ? `Changes apply to the items you uploaded. ${foreign.toLocaleString('en')} of the first ${BATCH_HYDRATE_LIMIT.toLocaleString('en')} were uploaded by others and stay as they are.`
                : `Changes apply to the ${plural(editable, 'item')} you uploaded. ${foreign.toLocaleString('en')} uploaded by others stay as they are.`}
            </span>
          </p>
        )
      )}
      {!verdict.ok && !allForeign && (
        <p className={classes.notice}>{verdict.reason}.</p>
      )}
      <BatchField
        key={`${key}:title`}
        batch={key}
        field='title'
        shared={shared('title')}
        locked={locked}
        refused={refused}
      />
      {(imageIds.length > 0 || unknownKinds > 0) && (
        <BatchField
          key={`${key}:alt`}
          batch={key}
          field='alt'
          shared={shared('alt', imageIds)}
          locked={locked}
          refused={refused}
          suffix={
            unknownKinds > 0 ? 'images only' : plural(imageIds.length, 'image')
          }
        />
      )}
      {missingAlt > 0 && !locked && (
        <BatchAltWarning missing={missingAlt} images={imageIds.length} />
      )}
      <BatchField
        key={`${key}:caption`}
        batch={key}
        field='caption'
        shared={shared('caption')}
        locked={locked}
        refused={refused}
      />
      <BatchField
        key={`${key}:description`}
        batch={key}
        field='description'
        shared={shared('description')}
        locked={locked}
        refused={refused}
      />
      <BatchActions deletable={deletable} />
    </div>
  )
}

function describeKinds(
  images: number,
  others: number,
  unknown: number,
): string | null {
  const parts: string[] = []
  if (images > 0) {
    parts.push(plural(images, 'image'))
  }
  if (others > 0) {
    parts.push(others === 1 ? '1 other file' : `${others} other files`)
  }
  if (unknown > 0) {
    parts.push(`${unknown.toLocaleString('en')} not loaded yet`)
  }
  return parts.length > 0 ? parts.join(', ') : null
}

/** Up to six thumbnails (+N); clicking one selects only that item. */
function Strip({
  ids,
  items,
}: {
  ids: readonly number[]
  items: ReadonlyMap<number, LibraryItemFull>
}) {
  const shown = ids.slice(0, STRIP_SIZE)
  const more = ids.length - shown.length
  return (
    <ul className={classes.strip} aria-label='Selected items'>
      {shown.map((id) => {
        const item = items.get(id)
        const source = item
          ? pictureFor(item, 40, 40, window.devicePixelRatio || 1)
          : null
        return (
          <li key={id}>
            <UnstyledButton
              className={classes.stripThumb}
              aria-label={`Select only ${item?.filename ?? `item ${id}`}`}
              onClick={() => coreStore.getState().selectOnly(id)}
            >
              {source ? (
                <img src={source} alt='' draggable={false} />
              ) : (
                <FileIcon size={18} aria-hidden />
              )}
            </UnstyledButton>
          </li>
        )
      })}
      {more > 0 && (
        <li className={classes.stripMore} aria-label={`and ${more} more`}>
          +{more.toLocaleString('en')}
        </li>
      )}
    </ul>
  )
}

interface BatchFieldProps {
  batch: string
  field: FieldName
  shared: ReturnType<typeof sharedValue>
  locked: boolean
  refused: boolean
  /** After the label: "· 4 images". */
  suffix?: string
}

const ROWS: Record<FieldName, number> = {
  title: 1,
  alt: 2,
  caption: 2,
  description: 3,
}

function BatchField({
  batch,
  field,
  shared,
  locked,
  refused,
  suffix,
}: BatchFieldProps) {
  const queryClient = useQueryClient()
  const key = batchFieldKey(batch, field)
  const entry = useInspector((state) => state.fields[key])
  const progress = useInspector((state) => state.progress[key] ?? null)
  // One mode for the panel (the store), read by the commit too (batch.ts).
  const storedMode = useInspector((state) => state.descriptionMode)
  const mode: DescriptionMode = field === 'description' ? storedMode : 'replace'
  const inputId = useId()
  const hintId = useId()
  const label = FIELD_LABELS[field]
  const appending = field === 'description' && mode === 'append'
  const current = appending ? '' : shared.current
  const mixed = !appending && shared.mixed

  useEffect(() => {
    const unmount = inspectorStore.getState().mountField(key)
    return () => {
      unmount()
      commitBatchOnLeave(queryClient, batch, field)
    }
  }, [queryClient, key, batch, field])

  // Edit details (the selection bar) asks for the first field once it is on
  // screen; a batch request has no item id.
  const focusRequest = useBridge((state) => state.focusRequest)
  useEffect(() => {
    if (
      !focusRequest ||
      focusRequest.id !== null ||
      focusRequest.field !== field
    ) {
      return
    }
    const input = document.getElementById(inputId)
    if (!(input instanceof HTMLElement)) {
      return
    }
    bridgeStore.getState().requestFocus(null)
    input.focus()
  }, [focusRequest, field, inputId])

  const value = displayValue(entry, current)
  const readOnly = locked || (refused && entry?.draft == null)
  const status = statusOf(entry)
  const state = readOnly
    ? 'readonly'
    : status === 'error'
      ? 'error'
      : mixed
        ? 'mixed'
        : undefined
  const commit = () => {
    void commitBatchField(queryClient, batch, field)
  }
  const onChange = (
    event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    if (readOnly) {
      return
    }
    const raw = event.currentTarget.value
    const text = isSingleLine(field) ? raw.replace(/\s*[\r\n]+\s*/g, ' ') : raw
    inspectorStore
      .getState()
      .updateField(key, (before) => edit(before, text, current))
  }
  const onKeyDown = (
    event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    if (event.nativeEvent.isComposing) {
      return
    }
    const mod = event.ctrlKey || event.metaKey
    if (event.key === 'Enter' && !event.altKey) {
      if (mod || isSingleLine(field)) {
        // Enter in Title / Alt text commits to all (§8); never a newline.
        event.preventDefault()
        if (!readOnly) {
          commit()
        }
      }
      return
    }
    if (event.key !== 'Escape' || mod || event.shiftKey || event.altKey) {
      return
    }
    event.preventDefault()
    const before = inspectorStore.getState().fields[key]
    if (before && (before.phase === 'dirty' || before.phase === 'error')) {
      inspectorStore.getState().updateField(key, revert)
      return
    }
    event.currentTarget.blur()
  }
  const chooseMode = (next: DescriptionMode) => {
    setDescriptionMode(next)
  }

  const placeholder = appending
    ? 'Text to add as a new paragraph to every description'
    : mixed
      ? shared.partial
        ? 'Mixed values'
        : `Mixed — ${shared.distinct} different values`
      : undefined
  const hint =
    status === 'error'
      ? `Not saved — ${entry?.error ?? "WordPress didn't respond"}. Your text is kept here.`
      : appending
        ? 'Added as a new paragraph to each description, then the field clears.'
        : mixed
          ? 'Leave empty to keep each item’s own text.'
          : null
  const common = {
    id: inputId,
    value,
    readOnly,
    placeholder,
    onChange,
    onBlur: readOnly ? undefined : commit,
    onKeyDown,
    'aria-describedby': hint ? hintId : undefined,
    error: status === 'error',
    'data-mm-field': field,
    classNames: { input: classes.input },
    'data-state': state,
  }
  return (
    <div className={classes.field} data-testid={`batch-field-${field}`}>
      <div className={classes.labelRow}>
        <label className={classes.label} htmlFor={inputId}>
          {label}
          {suffix && <span className={classes.labelSuffix}> · {suffix}</span>}
        </label>
        <FieldStatus
          status={status}
          onRetry={commit}
          label={label}
          progress={progress}
        />
      </div>
      {field === 'title' ? (
        <TextInput {...common} />
      ) : (
        <Textarea {...common} rows={ROWS[field]} />
      )}
      {hint && (
        <p
          id={hintId}
          className={classes.hint}
          data-tone={status === 'error' ? 'danger' : undefined}
        >
          {hint}
        </p>
      )}
      {field === 'description' && !locked && (
        <fieldset className={classes.modes}>
          <legend className={classes.srOnly}>How to change descriptions</legend>
          {(['replace', 'append'] as const).map((option) => (
            <UnstyledButton
              key={option}
              className={classes.mode}
              aria-pressed={mode === option}
              onClick={() => chooseMode(option)}
            >
              {option === 'replace' ? 'Replace' : 'Append'}
            </UnstyledButton>
          ))}
        </fieldset>
      )}
    </div>
  )
}
