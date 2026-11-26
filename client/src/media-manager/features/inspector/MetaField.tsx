// One autosaving text field of the Info panel (inspector.md §3–§4): Title,
// Alt text, Caption or Description of one item. No Save button: blur and
// Ctrl/Cmd+Enter commit; in Title and Alt text Enter saves and moves to the
// next item (Save & next), Shift+Enter to the previous one. Caption and
// Description are multi-line, so Enter is a line break there. Esc reverts,
// and a second Esc returns to the item's tile.
//
// The text lives in the feature store (keyed by item and field), not in the
// component, so it survives re-renders; the component is keyed by item, and
// unmounting it with unsaved text commits that text to its own item.

import { Textarea, TextInput, UnstyledButton } from '@mantine/core'
import { useQueryClient } from '@tanstack/react-query'
import {
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'
import { centerApi } from '../../core/collection/centerApi'
import { AlertIcon, CheckIcon } from '../../core/ui/icons'
import { urlStore } from '../../core/url/useUrlState'
import { displayValue, statusOf } from './autosave'
import { bridgeStore, type FieldName, useBridge } from './bridge'
import {
  commitField,
  commitOnLeave,
  editField,
  FIELD_LABELS,
  revertField,
} from './controller'
import classes from './Inspector.module.css'
import { rememberPosition, saveAndStep } from './saveNext'
import { fieldKey, inspectorStore, useInspector } from './store'

export interface MetaFieldProps {
  id: number
  field: FieldName
  /** The item's saved value. */
  current: string
  /** The user may not edit this item at all (Author): always read-only. */
  locked: boolean
  /**
   * Commits are refused right now (offline, …). A clean field is read-only;
   * one with a draft keeps taking input, so going offline mid-typing loses
   * nothing, and a commit is refused with the reason (the text stays).
   */
  refused: boolean
  /** Alt text of an image-like item: flag it while empty. */
  flagMissing?: boolean
  /** In detail mode a second Esc just leaves the field (no tile to return to). */
  detailMode: boolean
  /** Shown under the field (the alt pass's strip); gets the focus state. */
  below?: (focused: boolean) => ReactNode
}

/** Title and alt text are one line; caption and description are not. */
export function isSingleLine(field: FieldName): boolean {
  return field === 'title' || field === 'alt'
}

/** Pasted line breaks in a one-line field become spaces. */
function singleLine(value: string): string {
  return value.replace(/\s*[\r\n]+\s*/g, ' ')
}

const ROWS: Record<Exclude<FieldName, 'title'>, number> = {
  alt: 2,
  caption: 2,
  description: 3,
}

/** How long the end-of-collection nudge plays. */
const NUDGE_MS = 320

export function MetaField({
  id,
  field,
  current,
  locked,
  refused,
  flagMissing = false,
  detailMode,
  below,
}: MetaFieldProps) {
  const queryClient = useQueryClient()
  const key = fieldKey(id, field)
  const entry = useInspector((state) => state.fields[key])
  const inputRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null)
  const inputId = useId()
  const hintId = useId()
  const label = FIELD_LABELS[field]
  const [focused, setFocused] = useState(false)
  const [nudging, setNudging] = useState(false)

  // On screen while mounted; leaving with unsaved typing commits it to `id`.
  useEffect(() => {
    const unmount = inspectorStore.getState().mountField(key)
    return () => {
      unmount()
      commitOnLeave(queryClient, id, field)
    }
  }, [queryClient, key, id, field])

  // `A` and Save & next ask for this field once it is on screen.
  const focusRequest = useBridge((state) => state.focusRequest)
  useEffect(() => {
    if (focusRequest?.id !== id || focusRequest.field !== field) {
      return
    }
    const input = inputRef.current
    if (!input) {
      return
    }
    bridgeStore.getState().requestFocus(null)
    input.focus()
    const end = input.value.length
    input.setSelectionRange(end, end)
  }, [focusRequest, id, field])

  useEffect(() => {
    if (!nudging) {
      return
    }
    const timer = setTimeout(() => setNudging(false), NUDGE_MS)
    return () => clearTimeout(timer)
  }, [nudging])

  const value = displayValue(entry, current)
  const readOnly = locked || (refused && entry?.draft == null)
  const status = statusOf(entry)
  const missing = flagMissing && current.trim() === ''
  const warn = flagMissing && value.trim() === ''
  const state = readOnly
    ? 'readonly'
    : status === 'error'
      ? 'error'
      : warn
        ? 'warn'
        : undefined

  const commit = () => {
    void commitField(queryClient, id, field)
  }
  const onBlur = () => {
    setFocused(false)
    // A read-only field has no draft to send (Retry stays available).
    if (!readOnly) {
      commit()
    }
  }
  const onFocus = () => {
    setFocused(true)
    rememberPosition(id)
  }

  const onChange = (
    event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    if (readOnly) {
      return
    }
    const raw = event.currentTarget.value
    editField(id, field, isSingleLine(field) ? singleLine(raw) : raw, current)
  }

  /** Save & next / previous; at an end the field nudges. */
  const step = (direction: 1 | -1) => {
    if (readOnly) {
      return
    }
    if (saveAndStep(queryClient, id, field, direction) === 'edge') {
      setNudging(true)
    }
  }

  const onKeyDown = (
    event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    if (event.nativeEvent.isComposing) {
      return
    }
    const mod = event.ctrlKey || event.metaKey
    if (event.key === 'Enter' && !event.altKey) {
      if (mod) {
        // Commit and stay; with the Missing alt filter on, alt text moves
        // on too (the item would vanish under the cursor, §4).
        event.preventDefault()
        if (field === 'alt' && urlStore().get().alt === 'missing') {
          step(1)
        } else if (!readOnly) {
          commit()
        }
        return
      }
      if (isSingleLine(field)) {
        // Never a newline in a one-line field.
        event.preventDefault()
        step(event.shiftKey ? -1 : 1)
      }
      return
    }
    const plain = !mod && !event.shiftKey && !event.altKey
    if (event.key !== 'Escape' || !plain) {
      return
    }
    // Ours, not the app keymap's (which would just blur the field).
    event.preventDefault()
    if (revertField(id, field)) {
      return
    }
    const input = event.currentTarget
    if (!detailMode) {
      centerApi.focusTile(id)
    }
    if (document.activeElement === input) {
      input.blur()
    }
  }

  const describedBy =
    status === 'error' || (missing && !readOnly) ? hintId : undefined
  const common = {
    ref: inputRef,
    id: inputId,
    value,
    readOnly,
    onChange,
    onBlur,
    onFocus,
    onKeyDown,
    'aria-describedby': describedBy,
    // Mantine sets aria-invalid from it; the edge comes from data-state.
    error: status === 'error',
    'data-mm-field': field,
    classNames: { input: classes.input },
    'data-state': state,
    'data-nudge': nudging || undefined,
    // Enter moves on in one-line fields; say so to assistive tech.
    enterKeyHint: isSingleLine(field) ? ('next' as const) : undefined,
  }

  return (
    <div className={classes.field} data-testid={`field-${field}`}>
      <div className={classes.labelRow}>
        <label className={classes.label} htmlFor={inputId}>
          {label}
        </label>
        {missing && (
          <span className={classes.flag}>
            <AlertIcon size={13} aria-hidden />
            Missing
          </span>
        )}
        <FieldStatus status={status} onRetry={commit} label={label} />
      </div>
      {field === 'title' ? (
        <TextInput {...common} />
      ) : (
        <Textarea {...common} rows={ROWS[field]} />
      )}
      {status === 'error' ? (
        <p id={hintId} className={classes.hint} data-tone='danger'>
          Not saved — {entry?.error ?? "WordPress didn't respond"}. Your text is
          kept here.
        </p>
      ) : (
        missing &&
        !readOnly && (
          <p id={hintId} className={classes.hint} data-tone='warn'>
            Screen readers skip images without alt text.
          </p>
        )
      )}
      {below?.(focused)}
    </div>
  )
}

export function FieldStatus({
  status,
  onRetry,
  label,
  progress,
}: {
  status: ReturnType<typeof statusOf>
  onRetry: () => void
  label: string
  /** A batch commit's progress ("Saving… 200 / 1,000"). */
  progress?: { done: number; total: number } | null
}) {
  if (status === null) {
    return null
  }
  if (status === 'error') {
    return (
      <span className={classes.status} data-status='error'>
        <AlertIcon size={13} aria-hidden />
        Not saved
        <UnstyledButton
          type='button'
          className={classes.retry}
          aria-label={`Retry saving ${label.toLowerCase()}`}
          // Keep focus in the field: a blur would commit as well.
          onMouseDown={(event) => event.preventDefault()}
          onClick={onRetry}
        >
          Retry
        </UnstyledButton>
      </span>
    )
  }
  if (status === 'saved') {
    return (
      <span className={classes.status} data-status='saved'>
        <CheckIcon size={13} aria-hidden />
        Saved
      </span>
    )
  }
  const counted =
    status === 'saving' && progress && progress.total > 100
      ? ` ${progress.done.toLocaleString('en')} / ${progress.total.toLocaleString('en')}`
      : ''
  return (
    <span className={classes.status} data-status={status}>
      {status === 'saving' ? `Saving…${counted}` : 'Unsaved'}
    </span>
  )
}
