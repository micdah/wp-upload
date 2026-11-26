// The inline name input of a new or renamed folder (folders.md §4).
//
// - It takes focus with its text selected when it appears.
// - Enter, or moving focus away, saves; an empty name or Esc cancels (Esc
//   restores the old name of a rename).
// - It is uncontrolled, so re-renders (a count changing, the tree moving)
//   keep the half-typed name and the caret (folders.md §11).
// - Only one input exists at a time: actions read its text through the
//   draft reader when another edit takes over.

import { type KeyboardEvent, useEffect, useRef } from 'react'
import { useStore } from 'zustand'
import { cancelEdit, commitEdit, registerDraftReader } from './actions'
import classes from './Column.module.css'
import { MAX_FOLDER_NAME_LENGTH } from './model'
import { folderUiStore } from './store'

export function NameInput({
  initial,
  label,
}: {
  initial: string
  label: string
}) {
  const ref = useRef<HTMLInputElement>(null)
  // The edit this input belongs to: a blur after it ended (Esc, Enter, or
  // another edit took over) must not commit again.
  const editing = useStore(folderUiStore, (state) => state.editing)
  const ownEdit = useRef(editing)

  useEffect(() => {
    const input = ref.current
    if (!input) return
    input.focus({ preventScroll: false })
    input.select()
    registerDraftReader(() => input.value)
    return () => registerDraftReader(null)
  }, [])

  const isOwnEditLive = () =>
    ownEdit.current !== null &&
    folderUiStore.getState().editing === ownEdit.current

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      if (isOwnEditLive()) {
        void commitEdit(event.currentTarget.value, { refocus: true })
      }
    } else if (event.key === 'Escape') {
      // Claimed, so the app's keymap doesn't also leave the field.
      event.preventDefault()
      if (isOwnEditLive()) {
        cancelEdit()
      }
    }
    // Arrows, Home/End, Delete and letters edit the text, not the tree.
    event.stopPropagation()
  }

  return (
    <input
      ref={ref}
      className={classes.nameInput}
      name='folder-name'
      defaultValue={initial}
      maxLength={MAX_FOLDER_NAME_LENGTH}
      placeholder='Folder name'
      aria-label={label}
      autoComplete='off'
      spellCheck={false}
      onKeyDown={onKeyDown}
      onBlur={(event) => {
        if (isOwnEditLive()) {
          void commitEdit(event.currentTarget.value, { refocus: false })
        }
      }}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    />
  )
}
