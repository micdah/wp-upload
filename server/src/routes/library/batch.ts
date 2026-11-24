import { Router } from 'express'
import {
  type BatchItemChange,
  type BatchItemResult,
  type BatchResponse,
  LIMITS,
} from '../../../../shared/library-api.ts'
import { sendNoStore } from '../../lib/library/cache.ts'
import {
  asyncRoute,
  characters,
  invalidRequest,
  objectBody,
  parseId,
  parseIdArray,
  queryParams,
  rejectUnknownFields,
} from '../../lib/library/errors.ts'
import { pluginClient, sendUntilDone } from '../../lib/library/pluginClient.ts'
import { requireFeature } from './bootstrap.ts'
import { parseItemPatch } from './items.ts'

// POST items/batch (server-api.md §7.7): the same metadata change for many
// items, or a different one per item (Undo). The client chunks larger
// selections into requests of at most LIMITS.batchItems (D24).

export const batchRouter = Router()

/**
 * One item's change: `set` (an ItemPatch, possibly empty) and an optional
 * `appendDescription`. `param` prefixes field names in errors.
 */
function parseChange(
  id: number,
  rawSet: unknown,
  rawAppend: unknown,
  param: string,
): BatchItemChange {
  if (!rawSet || typeof rawSet !== 'object' || Array.isArray(rawSet)) {
    throw invalidRequest(`${param}set`, `${param}set must be an object.`)
  }
  let set: BatchItemChange['set']
  try {
    set = parseItemPatch(rawSet as Record<string, unknown>, {
      allowEmpty: true,
    })
  } catch (err) {
    throw prefixParam(err, `${param}set.`)
  }

  const change: BatchItemChange = { id, set }
  if (rawAppend !== undefined) {
    if (typeof rawAppend !== 'string' || rawAppend === '') {
      throw invalidRequest(
        `${param}appendDescription`,
        'appendDescription must be a non-empty string.',
      )
    }
    if (characters(rawAppend) > LIMITS.descriptionLength) {
      throw invalidRequest(
        `${param}appendDescription`,
        `appendDescription: at most ${LIMITS.descriptionLength} characters.`,
      )
    }
    if (set.description !== undefined) {
      throw invalidRequest(
        `${param}appendDescription`,
        'Send either set.description or appendDescription, not both.',
      )
    }
    change.appendDescription = rawAppend
  }
  if (Object.keys(set).length === 0 && change.appendDescription === undefined) {
    throw invalidRequest(
      `${param}set`,
      'Send at least one field to change, or appendDescription.',
    )
  }
  return change
}

/** Re-labels a validation error's `details.param` with a prefix. */
function prefixParam(err: unknown, prefix: string): unknown {
  const details = (err as { details?: Record<string, unknown> }).details
  if (details && typeof details.param === 'string') {
    details.param = `${prefix}${details.param}`
  }
  return err
}

/** Validates a `BatchRequest` (either form) into per-item changes. */
export function parseBatchRequest(
  body: Record<string, unknown>,
): BatchItemChange[] {
  if (body.items !== undefined) {
    rejectUnknownFields(body, ['items'])
    return parseEachForm(body.items)
  }
  rejectUnknownFields(body, ['ids', 'set', 'appendDescription'])
  const ids = parseIdArray(body.ids, 'ids', LIMITS.batchItems)
  const template = parseChange(
    ids[0] as number,
    body.set,
    body.appendDescription,
    '',
  )
  return ids.map((id) => ({ ...template, id }))
}

function parseEachForm(raw: unknown): BatchItemChange[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw invalidRequest('items', 'items must be a non-empty array.')
  }
  if (raw.length > LIMITS.batchItems) {
    throw invalidRequest(
      'items',
      `items: at most ${LIMITS.batchItems} items per request.`,
    )
  }
  const seen = new Set<number>()
  return raw.map((entry, index) => {
    const param = `items[${index}].`
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw invalidRequest(`items[${index}]`, 'Each item must be an object.')
    }
    const item = entry as Record<string, unknown>
    try {
      rejectUnknownFields(item, ['id', 'set', 'appendDescription'])
    } catch (err) {
      throw prefixParam(err, param)
    }
    const id = typeof item.id === 'number' ? parseId(item.id) : null
    if (id === null) {
      throw invalidRequest(`${param}id`, 'id must be a positive integer.')
    }
    if (seen.has(id)) {
      throw invalidRequest(`${param}id`, `Item ${id} is listed twice.`)
    }
    seen.add(id)
    return parseChange(id, item.set, item.appendDescription, param)
  })
}

batchRouter.post(
  '/items/batch',
  requireFeature('media-batch'),
  asyncRoute(async (req, res) => {
    queryParams(req, [])
    const changes = parseBatchRequest(objectBody(req))
    const { rev, results } = await sendUntilDone<
      BatchItemChange,
      BatchItemResult
    >(
      changes,
      (change) => change.id,
      (items) => pluginClient.mediaBatch({ items }),
    )
    const body: BatchResponse = { rev, results }
    sendNoStore(res, body, { rev })
  }),
)
