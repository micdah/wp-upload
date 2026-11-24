import { Router } from 'express'
import type { BatchItemChange } from '../../../../shared/library-api.ts'
import {
  ITEM_VIEWS,
  type ItemPatch,
  type ItemPatchResponse,
  type ItemView,
  LIBRARY_REV_HEADER,
  LIMITS,
  type LibraryItem,
} from '../../../../shared/library-api.ts'
import {
  cached,
  currentRev,
  etagFor,
  matchesIfNoneMatch,
  sendNoStore,
} from '../../lib/library/cache.ts'
import {
  asyncRoute,
  characters,
  invalidRequest,
  itemErrorToLibraryError,
  objectBody,
  parseId,
  parseIdList,
  pathId,
  queryParams,
  rejectUnknownFields,
} from '../../lib/library/errors.ts'
import { hydrateItems } from '../../lib/library/normalise/items.ts'
import { pluginClient, sendUntilDone } from '../../lib/library/pluginClient.ts'
import { requireFeature } from './bootstrap.ts'

// GET items (server-api.md §7.5) and PATCH items/:id (§7.6).

export const itemsRouter = Router()

// ---------------------------------------------------------------------------
// GET items
// ---------------------------------------------------------------------------

interface CachedItems {
  rev: string
  items: LibraryItem[]
  missing: number[]
}

itemsRouter.get(
  '/items',
  asyncRoute(async (req, res) => {
    const raw = queryParams(req, ['ids', 'view'])
    const ids = parseIdList(raw.ids, 'ids', LIMITS.itemIds)
    const view = (raw.view ?? 'tile') as ItemView
    if (!ITEM_VIEWS.includes(view)) {
      throw invalidRequest('view', 'view must be tile or full.')
    }

    const rev = await currentRev()
    const etag = etagFor(rev, `items?view=${view}&ids=${ids.join(',')}`)
    res.setHeader('Cache-Control', 'private, no-cache')
    res.setHeader('ETag', etag)
    res.setHeader(LIBRARY_REV_HEADER, rev)
    if (matchesIfNoneMatch(req, etag)) {
      res.status(304).end()
      return
    }

    // One cache entry per id set, whatever the order it was asked in.
    const sorted = [...ids].sort((a, b) => a - b)
    const value = (
      await cached<CachedItems>(
        `items?view=${view}&ids=${sorted.join(',')}@${rev}`,
        async () => ({ rev, ...(await hydrateItems(sorted, view)) }),
      )
    ).value()
    const byId = new Map(value.items.map((item) => [item.id, item]))
    const missing = new Set(value.missing)
    res.json({
      rev: value.rev,
      items: ids.flatMap((id) => byId.get(id) ?? []),
      missing: ids.filter((id) => missing.has(id)),
    })
  }),
)

// ---------------------------------------------------------------------------
// PATCH items/:id
// ---------------------------------------------------------------------------

const TEXT_LIMITS = {
  title: LIMITS.titleLength,
  alt: LIMITS.altLength,
  caption: LIMITS.captionLength,
  description: LIMITS.descriptionLength,
} as const

const PATCH_FIELDS = [...Object.keys(TEXT_LIMITS), 'post'] as const

/** Validates an `ItemPatch` body (also used for batch `set`s). */
export function parseItemPatch(
  body: Record<string, unknown>,
  { allowEmpty = false } = {},
): ItemPatch {
  rejectUnknownFields(body, PATCH_FIELDS)
  const patch: ItemPatch = {}

  for (const [field, limit] of Object.entries(TEXT_LIMITS) as Array<
    [keyof typeof TEXT_LIMITS, number]
  >) {
    const value = body[field]
    if (value === undefined) continue
    if (typeof value !== 'string') {
      throw invalidRequest(field, `${field} must be a string.`)
    }
    if (characters(value) > limit) {
      throw invalidRequest(field, `${field}: at most ${limit} characters.`)
    }
    patch[field] = value
  }

  if (body.post !== undefined) {
    if (body.post === null) {
      patch.post = null
    } else {
      const post = parseId(body.post)
      if (post === null || typeof body.post !== 'number') {
        throw invalidRequest(
          'post',
          'post must be a post id (a positive integer) or null to detach.',
        )
      }
      patch.post = post
    }
  }

  if (!allowEmpty && Object.keys(patch).length === 0) {
    throw invalidRequest('body', 'Send at least one field to change.')
  }
  return patch
}

itemsRouter.patch(
  '/items/:id',
  requireFeature('media-batch'),
  asyncRoute(async (req, res) => {
    const id = pathId(req)
    queryParams(req, [])
    const patch = parseItemPatch(objectBody(req))

    const { rev, results } = await sendUntilDone<
      BatchItemChange,
      Awaited<ReturnType<typeof pluginClient.mediaBatch>>['results'][number]
    >(
      [{ id, set: patch }],
      (change) => change.id,
      (items) => pluginClient.mediaBatch({ items }),
    )
    const result = results[0]
    if (!result) {
      throw new Error(`The plugin returned no result for item ${id}.`)
    }
    if (!result.ok) throw itemErrorToLibraryError(result.error)

    const body: ItemPatchResponse = {
      rev,
      id,
      previous: result.previous,
      item: result.item,
    }
    sendNoStore(res, body, { rev })
  }),
)
