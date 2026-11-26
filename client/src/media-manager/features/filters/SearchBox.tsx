// Search in the toolbar (interaction-spec §3): filters as you type, 150 ms
// after the last keystroke, across title, file name, caption, alt text and
// EXIF (the plugin's search, server-api.md §6). The text is the URL's `q`,
// written with replace (D16).
//
// - Enter writes at once; Esc clears the text, and Esc on an empty box
//   leaves it (the keymap blurs a text field on Esc).
// - The box follows the URL when `q` changes elsewhere (Clear filters,
//   Back/Forward), but never while a keystroke is waiting to be written.

import { TextInput } from '@mantine/core'
import { useEffect, useRef, useState } from 'react'
import { SearchIcon } from '../../core/ui/icons'
import { normaliseQuery } from '../../core/url/codec'
import { urlStore, useUrlState } from '../../core/url/useUrlState'
import classes from './Filters.module.css'

/** Keystrokes are written to the URL this long after the last one. */
export const SEARCH_DEBOUNCE_MS = 150

export function SearchBox() {
  // The Trash ignores search (server-api.md §6).
  const inTrash = useUrlState((state) => state.folder === 'trash')
  return inTrash ? null : <Search />
}

function Search() {
  const q = useUrlState((state) => state.q)
  const [text, setText] = useState(q ?? '')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Follow the URL, unless a keystroke is still on its way there.
  useEffect(() => {
    if (timer.current !== null) return
    setText((current) => (normaliseQuery(current) === q ? current : (q ?? '')))
  }, [q])

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current)
    },
    [],
  )

  const write = (value: string) => {
    if (timer.current !== null) {
      clearTimeout(timer.current)
      timer.current = null
    }
    const next = normaliseQuery(value)
    if (urlStore().get().q !== next) {
      urlStore().navigate({ q: next })
    }
  }

  const schedule = (value: string) => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      timer.current = null
      write(value)
    }, SEARCH_DEBOUNCE_MS)
  }

  return (
    <TextInput
      className={classes.search}
      classNames={{ input: classes.searchInput }}
      type='search'
      size='sm'
      leftSection={<SearchIcon size={16} aria-hidden />}
      placeholder='Search title, file name, caption, alt…'
      aria-label='Search media'
      autoComplete='off'
      spellCheck={false}
      value={text}
      onChange={(event) => {
        const value = event.currentTarget.value
        setText(value)
        schedule(value)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          write(text)
        } else if (event.key === 'Escape' && text !== '') {
          // Clear first; a second Esc leaves the field (the keymap).
          event.preventDefault()
          setText('')
          write('')
        }
      }}
    />
  )
}
