// One autosaving text field of the Info panel (inspector.md §3): Title or
// Alt text of one item. No Save button: blur, Enter and Ctrl/Cmd+Enter
// commit; Esc reverts, and a second Esc returns to the item's tile.
//
// The text lives in the feature store (keyed by item and field), not in the
// component, so it survives re-renders; the component is keyed by item, and
// unmounting it with unsaved text commits that text to its own item.

import { Textarea, TextInput, UnstyledButton } from '@mantine/core'
import { useQueryClient } from '@tanstack/react-query'
import {
  type ChangeEvent,
  type KeyboardEvent,
  useEffect,
  useId,
  useRef,
} from 'react'
import { centerApi } from '../../core/collection/centerApi'
import { AlertIcon, CheckIcon } from '../../core/ui/icons'
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
}

/** Alt text and titles are one line: pasted line breaks become spaces. */
function singleLine(value: string): string {
  return value.replace(/\s*[\r\n]+\s*/g, ' ')
}

export function MetaField({
  id,
  field,
  current,
  locked,
  refused,
  flagMissing = false,
  detailMode,
}: MetaFieldProps) {
  const queryClient = useQueryClient()
  const key = fieldKey(id, field)
  const entry = useInspector((state) => state.fields[key])
  const inputRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null)
  const inputId = useId()
  const hintId = useId()
  const label = FIELD_LABELS[field]

  // On screen while mounted; leaving with unsaved typing commits it to `id`.
  useEffect(() => {
    const unmount = inspectorStore.getState().mountField(key)
    return () => {
      unmount()
      commitOnLeave(queryClient, id, field)
    }
  }, [queryClient, key, id, field])

  // `A` (inspector.focus-alt) asks for this field once it is on screen.
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
  // A read-only field has no draft to send (Retry stays available).
  const onBlur = readOnly ? undefined : commit

  const onChange = (
    event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    if (readOnly) {
      return
    }
    editField(id, field, singleLine(event.currentTarget.value), current)
  }

  const onKeyDown = (
    event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    if (event.nativeEvent.isComposing) {
      return
    }
    if (event.key === 'Enter') {
      // Commit and stay (Save & next arrives with wave A). Never a newline.
      event.preventDefault()
      if (!readOnly) {
        commit()
      }
      return
    }
    const plain =
      !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey
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
    onKeyDown,
    'aria-describedby': describedBy,
    // Mantine sets aria-invalid from it; the edge comes from data-state.
    error: status === 'error',
    'data-mm-field': field,
    classNames: { input: classes.input },
    'data-state': state,
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
      {field === 'alt' ? (
        <Textarea {...common} rows={2} />
      ) : (
        <TextInput {...common} />
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
    </div>
  )
}

function FieldStatus({
  status,
  onRetry,
  label,
}: {
  status: ReturnType<typeof statusOf>
  onRetry: () => void
  label: string
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
  return (
    <span className={classes.status} data-status={status}>
      {status === 'saving' ? 'Saving…' : 'Unsaved'}
    </span>
  )
}
