// The post picker for Attach / Change… (inspector.md §5): a menu-styled
// popover under the button, with a search field and a list of published
// posts (core search, D21; empty search = the most recent ones).
//
// Keys: type to search (debounced), ArrowUp/ArrowDown move, Enter picks,
// Esc closes; picking and Esc return focus to the button. The search field
// is a combobox whose listbox options are pointed at with
// aria-activedescendant, so focus never leaves the field. The popover is
// marked [data-mm-local-keys]: the app keymap leaves its keys alone.

import { Button, TextInput } from '@mantine/core'
import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import type { PostRef } from '../../../../../../shared/library-api'
import { usePostSearch } from '../../../core/data/inspector'
import { useKeyLayer } from '../../../core/keymap'
import { FileIcon, PostIcon, SearchIcon } from '../../../core/ui/icons'
import { failureReason } from './attach'
import { statusLabel } from './model'
import classes from './Usage.module.css'

/** The dropdown's width and its distance from the window's edge. */
const PICKER_WIDTH = 280
const PICKER_MARGIN = 8

/** How long typing settles before the picker searches. */
const SEARCH_DEBOUNCE_MS = 200

/**
 * `value`, once it has stopped changing for `delay` ms. Local rather than
 * @mantine/hooks: nothing else in the media manager uses that package, and
 * a new dependency in the browser tests makes Vite re-optimise mid-run.
 */
function useDebouncedValue<T>(value: T, delay: number): [T] {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return [settled]
}

export interface PostPickerProps {
  /** The button's label: "Attach to…", "Change…", "Attach 4 to…". */
  children: ReactNode
  /** Called with the picked post after the popover closed. */
  onPick: (post: PostRef) => void
  disabled?: boolean
  /** Why it is disabled (the button's tooltip). */
  disabledReason?: string
  /** A change is running: the button says so and ignores clicks. */
  busy?: boolean
  /** The button, for focusing it after a change (e.g. after Detach). */
  buttonRef?: (element: HTMLButtonElement | null) => void
  leftSection?: ReactNode
  'data-testid'?: string
}

export function PostPicker({
  children,
  onPick,
  disabled = false,
  disabledReason,
  busy = false,
  buttonRef,
  leftSection,
  'data-testid': testId,
}: PostPickerProps) {
  const [opened, setOpened] = useState(false)
  const button = useRef<HTMLButtonElement | null>(null)

  const close = (returnFocus: boolean) => {
    setOpened(false)
    if (returnFocus) {
      button.current?.focus()
    }
  }

  // A press outside the picker (and its button) closes it.
  const anchor = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!opened) {
      return
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Node && !anchor.current?.contains(target)) {
        setOpened(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () =>
      document.removeEventListener('pointerdown', onPointerDown, true)
  }, [opened])

  // Esc through the app's key layers too (focus may be on the dialog
  // itself, not in the search field), returning focus to the button.
  useKeyLayer('post-picker', () => close(true), opened)

  // Fixed under the button, kept inside the window: no ancestor's overflow
  // (the File section's row, the panel's scroller) can clip it.
  // Placed when it opens, so the first render is visible and the search
  // field can take focus at once; then kept in step on scroll and resize.
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null)
  const measure = () => {
    const rect = button.current?.getBoundingClientRect()
    if (!rect) {
      return
    }
    const left = Math.max(
      PICKER_MARGIN,
      Math.min(rect.left, window.innerWidth - PICKER_WIDTH - PICKER_MARGIN),
    )
    setPlace({ top: rect.bottom + 4, left })
  }
  const measureRef = useRef(measure)
  measureRef.current = measure
  useLayoutEffect(() => {
    if (!opened) {
      return
    }
    const measure = () => measureRef.current()
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [opened])

  // A plain dropdown rather than Mantine's Popover: in this lazy chunk,
  // Popover pulled 2.5 kB gzip into the initial chunk (D31 budget).
  return (
    <div ref={anchor} className={classes.pickerAnchor}>
      <Button
        ref={(element) => {
          button.current = element
          buttonRef?.(element)
        }}
        type='button'
        size='xs'
        variant='default'
        className={classes.button}
        leftSection={leftSection}
        disabled={disabled}
        title={disabled ? disabledReason : undefined}
        aria-busy={busy || undefined}
        aria-haspopup='dialog'
        aria-expanded={opened}
        data-testid={testId}
        onClick={() => {
          if (busy) {
            return
          }
          if (!opened) {
            measure()
          }
          setOpened(!opened)
        }}
      >
        {children}
      </Button>
      {opened && (
        <div
          role='dialog'
          className={classes.picker}
          style={
            place
              ? { top: place.top, left: place.left, width: PICKER_WIDTH }
              : { width: PICKER_WIDTH }
          }
          aria-label='Attach to a post or page'
          data-mm-local-keys=''
          data-testid='post-picker'
          onKeyDown={(event) => {
            if (event.key === 'Escape' && !event.defaultPrevented) {
              event.preventDefault()
              close(true)
            }
          }}
          onMouseDown={(event) => {
            // A press on something that can't take focus (padding, a
            // label, an option) would drop focus to the page: keep it in
            // the search field. Options still get their click.
            const target = event.target
            if (
              target instanceof Element &&
              !target.closest('input, button, a, textarea')
            ) {
              event.preventDefault()
            }
          }}
          onBlur={(event) => {
            // Tabbing out of the picker closes it (focus stays where it went).
            const next = event.relatedTarget
            if (next instanceof Node && !event.currentTarget.contains(next)) {
              close(false)
            }
          }}
        >
          <PickerBody
            onPick={(post) => {
              close(true)
              onPick(post)
            }}
            onEscape={() => close(true)}
          />
        </div>
      )}
    </div>
  )
}

function PickerBody({
  onPick,
  onEscape,
}: {
  onPick: (post: PostRef) => void
  onEscape: () => void
}) {
  const [text, setText] = useState('')
  const [search] = useDebouncedValue(text, SEARCH_DEBOUNCE_MS)
  const query = usePostSearch(search)
  const posts = query.data?.posts ?? []
  const [activeId, setActiveId] = useState<number | null>(null)
  const found = posts.findIndex((post) => post.postId === activeId)
  const active = found === -1 ? 0 : found
  const listId = useId()
  const labelId = useId()
  const input = useRef<HTMLInputElement>(null)
  const optionId = (post: PostRef) => `${listId}-${post.postId}`
  const activePost = posts[active]

  useEffect(() => {
    input.current?.focus()
  }, [])

  useEffect(() => {
    if (activePost) {
      document
        .getElementById(`${listId}-${activePost.postId}`)
        ?.scrollIntoView({ block: 'nearest' })
    }
  }, [activePost, listId])

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (posts.length > 0) {
        const step = event.key === 'ArrowDown' ? 1 : -1
        const next = (active + step + posts.length) % posts.length
        setActiveId(posts[next]?.postId ?? null)
      }
    } else if (event.key === 'Enter') {
      event.preventDefault()
      // Not on a list the typing has already left behind.
      const settled = text === search && !query.isPlaceholderData
      if (activePost && settled) {
        onPick(activePost)
      }
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onEscape()
    }
  }

  const expanded = posts.length > 0
  return (
    <div className={classes.pickerBody}>
      <div id={labelId} className={classes.pickerLabel}>
        Attach to
      </div>
      <TextInput
        ref={input}
        size='xs'
        type='search'
        value={text}
        onChange={(event) => setText(event.currentTarget.value)}
        onKeyDown={onKeyDown}
        placeholder='Search posts and pages'
        aria-label='Search posts and pages'
        role='combobox'
        aria-autocomplete='list'
        aria-expanded={expanded}
        aria-controls={listId}
        aria-activedescendant={
          expanded && activePost ? optionId(activePost) : undefined
        }
        autoComplete='off'
        spellCheck={false}
        leftSection={<SearchIcon size={14} aria-hidden />}
        classNames={{ root: classes.search }}
      />
      {query.isPending ? (
        <p className={classes.pickerEmpty}>Searching…</p>
      ) : query.isError && posts.length === 0 ? (
        <div className={classes.pickerEmpty}>
          <span>Couldn’t load posts: {failureReason(query.error)}.</span>{' '}
          <Button
            type='button'
            size='compact-xs'
            variant='subtle'
            onClick={() => void query.refetch()}
          >
            Retry
          </Button>
        </div>
      ) : posts.length === 0 ? (
        <p className={classes.pickerEmpty}>No published post matches</p>
      ) : (
        <div
          id={listId}
          role='listbox'
          aria-labelledby={labelId}
          className={classes.options}
          aria-busy={query.isPlaceholderData || undefined}
        >
          {posts.map((post, index) => {
            const Icon = post.postType === 'page' ? FileIcon : PostIcon
            return (
              // biome-ignore lint/a11y/useKeyWithClickEvents: the combobox field handles the keys (aria-activedescendant)
              // biome-ignore lint/a11y/useFocusableInteractive: options are pointed at with aria-activedescendant; focus stays in the field
              <div
                key={post.postId}
                id={optionId(post)}
                role='option'
                aria-selected={index === active}
                className={classes.option}
                data-active={index === active || undefined}
                // Keep focus in the search field.
                onMouseDown={(event) => event.preventDefault()}
                onMouseMove={() => setActiveId(post.postId)}
                onClick={() => onPick(post)}
              >
                <Icon size={16} aria-hidden className={classes.optionIcon} />
                <span className={classes.optionText}>
                  <span className={classes.optionTitle}>{post.title}</span>
                  <span className={classes.optionMeta}>
                    {post.postTypeLabel} · {statusLabel(post.status)}
                  </span>
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
