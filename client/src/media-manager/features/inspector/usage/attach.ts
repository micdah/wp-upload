// Attach and detach as the user sees them (inspector.md §5, §7): the
// mutation from core/data, then one toast that says what happened and
// offers Undo, which puts every item back on the post it had. Failures
// become an error toast with the server's message. Permission checks happen
// in the panel before these run (only allowed items get here).

import type { QueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import type {
  LibraryItemFull,
  PostRef,
} from '../../../../../../shared/library-api'
import { isLibraryError } from '../../../core/data/errors'
import {
  attachItem,
  attachItems,
  undoAttachItems,
} from '../../../core/data/inspector'
import { plural } from '../../../core/ui/announce'
import { toast } from '../../../core/ui/toast'

/** The server's message without its full stop, or a generic one. */
export function failureReason(error: unknown): string {
  if (isLibraryError(error) || error instanceof Error) {
    return error.message.replace(/\.$/, '') || 'WordPress didn’t respond'
  }
  return 'WordPress didn’t respond'
}

/**
 * Attaches one item to `post` (null detaches). Resolves true once saved and
 * the toast shows; false after an error toast.
 */
export async function changeAttachment(
  queryClient: QueryClient,
  item: LibraryItemFull,
  post: PostRef | null,
): Promise<boolean> {
  const previous = item.attachedTo
  try {
    await attachItem(queryClient, item.id, post?.postId ?? null, post)
  } catch (error) {
    toast({
      tone: 'error',
      message: post
        ? `Couldn’t attach “${item.title}” to “${post.title}”: ${failureReason(error)}`
        : `Couldn’t detach “${item.title}”: ${failureReason(error)}`,
    })
    return false
  }
  const message = post
    ? `Attached to “${post.title}”`
    : `Detached from “${previous?.title ?? 'its post'}”`
  toast({
    tone: 'success',
    message,
    undo: {
      run: () =>
        attachItem(queryClient, item.id, previous?.postId ?? null, previous),
      done: 'Attachment restored',
    },
  })
  return true
}

/**
 * Attaches several items to `post` (null detaches) through bulkBatch. One
 * toast: what changed, what the server refused, and Undo for what changed.
 */
export async function changeAttachments(
  queryClient: QueryClient,
  items: readonly LibraryItemFull[],
  post: PostRef | null,
): Promise<boolean> {
  const outcome = await attachItems(
    queryClient,
    items.map((item) => item.id),
    post,
  )
  const refused =
    outcome.failed.length > 0
      ? `${plural(outcome.failed.length, 'item')} not changed: ${outcome.failure ?? 'refused'}`
      : null
  const stopped =
    outcome.error === null || outcome.error === undefined
      ? null
      : `Stopped: ${failureReason(outcome.error)}`
  const problems = [refused, stopped].filter(Boolean).join('. ')
  if (outcome.changed.length === 0) {
    toast({
      tone: 'error',
      message: `Couldn’t ${post ? 'attach' : 'detach'} the items. ${problems || 'Nothing was changed'}.`,
    })
    return false
  }
  const what = plural(outcome.changed.length, 'item')
  const done = post ? `Attached ${what} to “${post.title}”` : `Detached ${what}`
  const undo = outcome.undo
  toast({
    tone: problems ? 'warning' : 'success',
    message: problems ? `${done}. ${problems}.` : done,
    undo: {
      run: async () => {
        const back = await undoAttachItems(queryClient, undo)
        if (back.error !== null && back.error !== undefined) {
          throw new Error(failureReason(back.error))
        }
        if (back.failed.length > 0) {
          throw new Error(back.failure ?? 'WordPress refused some items')
        }
      },
      done: 'Attachments restored',
    },
  })
  return true
}

export type PendingChange = 'attach' | 'detach' | null

/**
 * Runs one change at a time and says which is running, so the buttons can
 * show it. `run` resolves with whether it succeeded.
 */
export function usePendingChange(): {
  pending: PendingChange
  run: (
    kind: Exclude<PendingChange, null>,
    task: () => Promise<boolean>,
  ) => Promise<boolean>
} {
  const [pending, setPending] = useState<PendingChange>(null)
  const run = useCallback(
    async (
      kind: Exclude<PendingChange, null>,
      task: () => Promise<boolean>,
    ): Promise<boolean> => {
      setPending(kind)
      try {
        return await task()
      } finally {
        setPending(null)
      }
    },
    [],
  )
  return { pending, run }
}
