// A button that copies a URL (inspector.md §2 File and Sizes, §9). On
// success it says "Copied" for a moment and announces "URL copied". Without
// a usable clipboard it selects the URL instead, in the given input or in a
// read-only field it reveals, and tells the user to copy it by hand.
//
// The URL is copied as the server sent it: never with the display-only
// `?v=` cache buster (server-api.md §8.1), never root-relative.

import { ActionIcon, Button, Tooltip } from '@mantine/core'
import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import { announce } from '../../../core/ui/announce'
import { CheckIcon, CopyIcon } from '../../../core/ui/icons'
import {
  COPIED_MESSAGE,
  COPIED_MS,
  COPY_BY_HAND_MESSAGE,
  copyText,
} from './clipboard'
import { absoluteUrl } from './details'
import classes from './Sections.module.css'

export interface CopyButtonProps {
  url: string
  /**
   * - `field`: "Copy", joined to the URL input before it (pass `inputRef`).
   * - `text`: a small ghost "Copy URL" button.
   * - `icon`: an icon button; `label` is its accessible name.
   */
  variant: 'field' | 'text' | 'icon'
  /** Accessible name, e.g. "Copy URL of Large size". Default: the text. */
  label?: string
  /** The input showing this URL, selected when the clipboard fails. */
  inputRef?: RefObject<HTMLInputElement | null>
  /** Visible text of `field` / `text` buttons. */
  children?: ReactNode
}

function selectAll(input: HTMLInputElement): void {
  input.focus()
  input.select()
}

export function CopyButton({
  url,
  variant,
  label,
  inputRef,
  children,
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const fallbackRef = useRef<HTMLInputElement | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const absolute = absoluteUrl(url, document.baseURI)

  useEffect(
    () => () => {
      if (timer.current !== null) {
        clearTimeout(timer.current)
      }
    },
    [],
  )

  // A revealed fallback field takes focus and selects the URL as it mounts.
  const revealRef = useCallback((node: HTMLInputElement | null) => {
    fallbackRef.current = node
    if (node) {
      selectAll(node)
    }
  }, [])

  const showCopied = useCallback(() => {
    setCopied(true)
    if (timer.current !== null) {
      clearTimeout(timer.current)
    }
    timer.current = setTimeout(() => {
      timer.current = null
      setCopied(false)
    }, COPIED_MS)
  }, [])

  const fallBack = useCallback(() => {
    const target = inputRef?.current ?? fallbackRef.current
    if (target) {
      selectAll(target)
    } else {
      setRevealed(true)
    }
    announce(COPY_BY_HAND_MESSAGE)
  }, [inputRef])

  const onClick = useCallback(async () => {
    if (await copyText(absolute)) {
      showCopied()
      announce(COPIED_MESSAGE)
    } else {
      fallBack()
    }
  }, [absolute, showCopied, fallBack])

  const fallbackField = revealed && (
    <input
      ref={revealRef}
      className={classes.fallbackInput}
      readOnly
      value={absolute}
      aria-label={label ? `${label}: press Ctrl+C or Cmd+C` : 'URL to copy'}
      onFocus={(event) => event.currentTarget.select()}
    />
  )

  if (variant === 'icon') {
    const name = label ?? 'Copy URL'
    return (
      <>
        <Tooltip
          label={copied ? 'Copied' : name}
          openDelay={400}
          withinPortal
          events={{ hover: true, focus: true, touch: false }}
        >
          <ActionIcon
            type='button'
            variant='subtle'
            color='gray'
            size='md'
            className={classes.sizeCopy}
            aria-label={name}
            data-copied={copied || undefined}
            onClick={onClick}
          >
            {copied ? (
              <CheckIcon size={14} aria-hidden className={classes.decor} />
            ) : (
              <CopyIcon size={14} aria-hidden className={classes.decor} />
            )}
          </ActionIcon>
        </Tooltip>
        {fallbackField}
      </>
    )
  }

  const text = copied ? 'Copied' : (children ?? 'Copy')
  return (
    <>
      <Button
        type='button'
        variant={variant === 'field' ? 'default' : 'subtle'}
        size='xs'
        className={
          variant === 'field' ? classes.copyFieldButton : classes.textAction
        }
        aria-label={label}
        data-copied={copied || undefined}
        leftSection={
          variant === 'field' ? (
            copied ? (
              <CheckIcon size={14} aria-hidden className={classes.decor} />
            ) : (
              <CopyIcon size={14} aria-hidden className={classes.decor} />
            )
          ) : undefined
        }
        onClick={onClick}
      >
        {text}
      </Button>
      {fallbackField}
    </>
  )
}
