// Spike C4: core/ui/confirm.tsx with the proposed focus-return fix
// (`?patched=1`). Only the lines marked "C4" differ from core.
//
// confirm(): one shared confirm dialog with rich content (system.md §9
// request 6). The body is any ReactNode (thumbnails, where-used lists), and
// `typeToConfirm` makes the user type a word or number before the confirm
// button enables (e.g. the item count when deleting 25 or more).
//
//     if (await confirm({ title: 'Delete 30 items?', body: <List/>,
//         confirmLabel: 'Delete', tone: 'danger', typeToConfirm: '30' })) { … }
//
// <ConfirmHost/> renders it; the app mounts it once. Requests made while one
// is open wait their turn.

import { Button, Group, Modal, Stack, Text, TextInput } from '@mantine/core'
import { type ReactNode, useState, useSyncExternalStore } from 'react'

export interface ConfirmOptions {
  title: ReactNode
  body?: ReactNode
  /** Default "Confirm". */
  confirmLabel?: string
  /** Default "Cancel". */
  cancelLabel?: string
  /** `danger` paints the confirm button red and focuses Cancel first. */
  tone?: 'default' | 'danger'
  /** The exact text the user must type before confirming. */
  typeToConfirm?: string
  /** The prompt above the field. Default: `Type <text> to confirm`. */
  typeToConfirmLabel?: ReactNode
}

interface Request {
  id: number
  options: ConfirmOptions
  resolve: (confirmed: boolean) => void
  /** C4: the element focused when confirm() was called. */
  opener: Element | null
}

let queue: readonly Request[] = []
let nextId = 1
const listeners = new Set<() => void>()

function setQueue(next: readonly Request[]): void {
  queue = next
  for (const listener of listeners) {
    listener()
  }
}

export function confirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    setQueue([
      ...queue,
      { id: nextId++, options, resolve, opener: document.activeElement },
    ])
  })
}

function settle(id: number, confirmed: boolean): void {
  const request = queue.find((entry) => entry.id === id)
  if (!request) {
    return
  }
  setQueue(queue.filter((entry) => entry.id !== id))
  request.resolve(confirmed)
  if (queue.length === 0) {
    restoreFocus(request.opener)
  }
}

// C4: ConfirmHost unmounts the Modal as soon as the request settles, so
// Mantine's returnFocus (which runs when `opened` turns false) never runs
// and focus falls to <body>. Put it back on the opener after the unmount.
function restoreFocus(opener: Element | null): void {
  requestAnimationFrame(() => {
    const active = document.activeElement
    const focusLost = active === null || active === document.body
    if (focusLost && opener instanceof HTMLElement && opener.isConnected) {
      opener.focus()
    }
  })
}

/** Tests: the open request's options, if any. */
export function pendingConfirm(): ConfirmOptions | null {
  return queue[0]?.options ?? null
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function ConfirmDialog({ request }: { request: Request }) {
  const { options } = request
  const [typed, setTyped] = useState('')
  const needsTyping = options.typeToConfirm !== undefined
  const typedOk = !needsTyping || typed.trim() === options.typeToConfirm
  const danger = options.tone === 'danger'
  return (
    <Modal
      opened
      onClose={() => settle(request.id, false)}
      title={options.title}
      centered
      closeButtonProps={{ 'aria-label': 'Cancel' }}
      data-mm-confirm=''
    >
      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (typedOk) {
            settle(request.id, true)
          }
        }}
      >
        <Stack gap='md'>
          {options.body !== undefined &&
            (typeof options.body === 'string' ? (
              <Text size='sm'>{options.body}</Text>
            ) : (
              options.body
            ))}
          {needsTyping && (
            <TextInput
              label={
                options.typeToConfirmLabel ?? (
                  <>
                    Type <strong>{options.typeToConfirm}</strong> to confirm
                  </>
                )
              }
              value={typed}
              onChange={(event) => setTyped(event.currentTarget.value)}
              autoComplete='off'
              data-autofocus
            />
          )}
          <Group justify='flex-end' gap='sm'>
            <Button
              type='button'
              variant='default'
              onClick={() => settle(request.id, false)}
              data-autofocus={danger && !needsTyping ? true : undefined}
            >
              {options.cancelLabel ?? 'Cancel'}
            </Button>
            <Button
              type='submit'
              color={danger ? 'red' : undefined}
              disabled={!typedOk}
              data-autofocus={!danger && !needsTyping ? true : undefined}
            >
              {options.confirmLabel ?? 'Confirm'}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  )
}

/** Renders the open confirm request. Mount once. */
export function ConfirmHost() {
  const current = useSyncExternalStore(
    subscribe,
    () => queue[0] ?? null,
    () => null,
  )
  return current ? <ConfirmDialog key={current.id} request={current} /> : null
}
