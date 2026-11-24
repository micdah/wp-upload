import { type Request, type RequestHandler, Router } from 'express'
import {
  EDIT_TARGETS,
  type EditOp,
  type EditRequest,
  type EditTarget,
  type ExpectedModified,
  type ImageJobResult,
  type JobAccepted,
  LIMITS,
  type RegenerateItemResult,
  ROTATE_ANGLES,
} from '../../../../shared/library-api.ts'
import type { PluginImageOpResponse } from '../../../../shared/plugin-api.ts'
import { sendNoStore } from '../../lib/library/cache.ts'
import {
  asyncRoute,
  invalidRequest,
  LibraryError,
  objectBody,
  parseIdArray,
  pathId,
  queryParams,
  rejectUnknownFields,
  toLibraryError,
} from '../../lib/library/errors.ts'
import {
  type JobContext,
  multipartFileBody,
  readBack,
  receiveFile,
  removeTempFile,
  startJob,
} from '../../lib/library/jobs.ts'
import { pluginClient } from '../../lib/library/pluginClient.ts'
import { requireFeature } from './bootstrap.ts'

// The image operations (server-api.md §7.12): edit, undo, restore, replace
// and regenerate. Each validates its input synchronously (400), answers 202
// with a job id, and runs the plugin call as a job (lib/library/jobs.ts).
// Everything WordPress answers arrives in `job.error` (mapped by §2.3).

export const imagesRouter = Router()

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const ISO_TIME = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$/

/** `expectedModified`: the item's `modifiedAt` (ISO 8601, whole seconds). */
export function parseExpectedModified(raw: unknown): string {
  if (typeof raw !== 'string' || !ISO_TIME.test(raw)) {
    throw invalidRequest(
      'expectedModified',
      'expectedModified must be the item’s modifiedAt, e.g. 2026-11-22T10:15:00Z.',
    )
  }
  return raw
}

function plainObject(raw: unknown, param: string): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw invalidRequest(param, `${param} must be an object.`)
  }
  return raw as Record<string, unknown>
}

function fieldsOnly(
  object: Record<string, unknown>,
  allowed: readonly string[],
  param: string,
): void {
  for (const key of Object.keys(object)) {
    if (!allowed.includes(key)) {
      throw invalidRequest(`${param}.${key}`, `Unknown field "${key}".`)
    }
  }
}

function integer(raw: unknown, param: string, min: number): number {
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < min) {
    throw invalidRequest(
      param,
      `${param} must be a whole number of at least ${min}.`,
    )
  }
  return raw
}

function parseOp(raw: unknown, param: string): EditOp {
  const op = plainObject(raw, param)
  switch (op.op) {
    case 'rotate': {
      fieldsOnly(op, ['op', 'angle'], param)
      const angle = op.angle as (typeof ROTATE_ANGLES)[number]
      if (!ROTATE_ANGLES.includes(angle)) {
        throw invalidRequest(`${param}.angle`, 'angle must be 90, 180 or 270.')
      }
      return { op: 'rotate', angle }
    }
    case 'flipH':
    case 'flipV':
      fieldsOnly(op, ['op'], param)
      return { op: op.op }
    case 'crop':
      fieldsOnly(op, ['op', 'x', 'y', 'width', 'height'], param)
      return {
        op: 'crop',
        x: integer(op.x, `${param}.x`, 0),
        y: integer(op.y, `${param}.y`, 0),
        width: integer(op.width, `${param}.width`, 1),
        height: integer(op.height, `${param}.height`, 1),
      }
    default:
      throw invalidRequest(
        `${param}.op`,
        'op must be rotate, flipH, flipV or crop.',
      )
  }
}

/**
 * Validates an `EditRequest`: shape, limits, integer coordinates and sizes
 * of at least 1. Bounds, proportionality and "down only" are the plugin's
 * checks (`wpu_invalid_edit`, in `job.error`).
 */
export function parseEditRequest(body: Record<string, unknown>): EditRequest {
  rejectUnknownFields(body, ['ops', 'scale', 'applyTo', 'expectedModified'])
  if (!Array.isArray(body.ops)) {
    throw invalidRequest('ops', 'ops must be an array (it may be empty).')
  }
  if (body.ops.length > LIMITS.editOps) {
    throw invalidRequest('ops', `ops: at most ${LIMITS.editOps} operations.`)
  }
  const ops = body.ops.map((op, index) => parseOp(op, `ops[${index}]`))

  let scale: EditRequest['scale']
  if (body.scale !== undefined) {
    const raw = plainObject(body.scale, 'scale')
    fieldsOnly(raw, ['width', 'height'], 'scale')
    scale = {
      width: integer(raw.width, 'scale.width', 1),
      height: integer(raw.height, 'scale.height', 1),
    }
  }
  if (ops.length === 0 && !scale) {
    throw invalidRequest('ops', 'Send at least one operation or a scale.')
  }

  const applyTo = body.applyTo as EditTarget
  if (!EDIT_TARGETS.includes(applyTo)) {
    throw invalidRequest(
      'applyTo',
      'applyTo must be all, thumbnail or nothumb.',
    )
  }
  const expectedModified = parseExpectedModified(body.expectedModified)
  return scale
    ? { ops, scale, applyTo, expectedModified }
    : { ops, applyTo, expectedModified }
}

/** A `{expectedModified}` body (edit/undo, restore). */
function parseExpectedModifiedBody(req: Request): ExpectedModified {
  const body = objectBody(req)
  rejectUnknownFields(body, ['expectedModified'])
  return { expectedModified: parseExpectedModified(body.expectedModified) }
}

// ---------------------------------------------------------------------------
// The jobs
// ---------------------------------------------------------------------------

/**
 * Runs one plugin image operation and reads the item back (full view), so
 * the client gets the new dimensions, sizes and flags in one go.
 */
async function imageOperation(
  itemId: number,
  call: () => Promise<PluginImageOpResponse>,
): Promise<ImageJobResult> {
  const answer = await call()
  const item = await readBack(itemId, 'full')
  return {
    item,
    sizesRegenerated: answer.sizesRegenerated,
    urlChanged: answer.urlChanged,
  }
}

function accepted(res: Parameters<RequestHandler>[1], jobId: string): void {
  const body: JobAccepted = { jobId }
  sendNoStore(res, body, { status: 202 })
}

imagesRouter.post(
  '/items/:id/edit',
  requireFeature('image-edit'),
  asyncRoute(async (req, res) => {
    const id = pathId(req)
    queryParams(req, [])
    const edit = parseEditRequest(objectBody(req))
    const jobId = startJob({
      kind: 'edit',
      itemId: id,
      run: () => imageOperation(id, () => pluginClient.imageEdit(id, edit)),
    })
    accepted(res, jobId)
  }),
)

imagesRouter.post(
  '/items/:id/edit/undo',
  requireFeature('image-edit'),
  asyncRoute(async (req, res) => {
    const id = pathId(req)
    queryParams(req, [])
    const body = parseExpectedModifiedBody(req)
    const jobId = startJob({
      kind: 'edit-undo',
      itemId: id,
      run: () => imageOperation(id, () => pluginClient.imageEditUndo(id, body)),
    })
    accepted(res, jobId)
  }),
)

imagesRouter.post(
  '/items/:id/restore',
  requireFeature('image-edit'),
  asyncRoute(async (req, res) => {
    const id = pathId(req)
    queryParams(req, [])
    const body = parseExpectedModifiedBody(req)
    const jobId = startJob({
      kind: 'restore',
      itemId: id,
      run: () => imageOperation(id, () => pluginClient.imageRestore(id, body)),
    })
    accepted(res, jobId)
  }),
)

// ---------------------------------------------------------------------------
// Replace (multipart)
// ---------------------------------------------------------------------------

/** Checks the path id before multer reads a possibly large body. */
const replaceTarget: RequestHandler = (req, _res, next) => {
  try {
    pathId(req)
    queryParams(req, [])
    next()
  } catch (err) {
    next(err)
  }
}

imagesRouter.post(
  '/items/:id/replace',
  requireFeature('image-replace'),
  replaceTarget,
  receiveFile,
  asyncRoute(async (req, res) => {
    const id = pathId(req)
    const file = req.file
    if (!file) {
      throw new LibraryError(400, 'upload_error', 'No file was provided.')
    }
    let expectedModified: string
    try {
      expectedModified = parseExpectedModified(req.body?.expectedModified)
    } catch (err) {
      removeTempFile(file.path)
      throw err
    }

    const jobId = startJob(
      {
        kind: 'replace',
        itemId: id,
        run: (context) => replaceFile(id, file, expectedModified, context),
      },
      () => removeTempFile(file.path),
    )
    accepted(res, jobId)
  }),
)

async function replaceFile(
  id: number,
  file: Express.Multer.File,
  expectedModified: string,
  context: JobContext,
): Promise<ImageJobResult> {
  const upload = multipartFileBody(
    file,
    { expectedModified },
    {
      onProgress: (done, total) =>
        context.setProgress({ done, total, unit: 'bytes' }),
    },
  )
  try {
    return await imageOperation(id, () =>
      pluginClient.imageReplace(id, upload, { signal: context.signal }),
    )
  } finally {
    // Closes the temp file if the request failed part-way.
    upload.body.destroy()
  }
}

// ---------------------------------------------------------------------------
// Regenerate
// ---------------------------------------------------------------------------

/**
 * Errors that stop a regenerate job instead of failing one item: WordPress
 * or the plugin is gone, so the remaining items would fail the same way.
 */
const FATAL_CODES = new Set([
  'wp_unreachable',
  'wp_auth_failed',
  'wp_redirect',
  'plugin_missing',
])

async function regenerate(
  ids: number[],
  context: JobContext,
): Promise<{ results: RegenerateItemResult[] }> {
  const results: RegenerateItemResult[] = []
  context.setProgress({ done: 0, total: ids.length, unit: 'items' })
  for (const id of ids) {
    try {
      const answer = await pluginClient.imageRegenerate(id)
      results.push({ id, ok: true, sizesRegenerated: answer.sizesRegenerated })
    } catch (err) {
      const { body } = toLibraryError(err)
      if (FATAL_CODES.has(body.code)) throw err
      results.push({
        id,
        ok: false,
        error: { code: body.code, message: body.message },
      })
    }
    context.setProgress({
      done: results.length,
      total: ids.length,
      unit: 'items',
    })
  }
  return { results }
}

imagesRouter.post(
  '/items/regenerate',
  requireFeature('image-regenerate'),
  asyncRoute(async (req, res) => {
    queryParams(req, [])
    const body = objectBody(req)
    rejectUnknownFields(body, ['ids'])
    const ids = parseIdArray(body.ids, 'ids', LIMITS.regenerateIds)
    const jobId = startJob({
      kind: 'regenerate',
      itemIds: ids,
      run: (context) => regenerate(ids, context),
    })
    accepted(res, jobId)
  }),
)
