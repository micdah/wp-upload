import { type Response, Router } from 'express'
import {
  type FolderAssignRequest,
  type FolderCreateRequest,
  type FolderUpdateRequest,
  LIMITS,
} from '../../../../shared/library-api.ts'
import { sendNoStore, serveCachedRead } from '../../lib/library/cache.ts'
import {
  asyncRoute,
  characters,
  invalidRequest,
  objectBody,
  parseIdArray,
  pathId,
  queryParams,
  rejectUnknownFields,
} from '../../lib/library/errors.ts'
import {
  normaliseFolderDelete,
  normaliseFolderMutation,
  normaliseFolderName,
  normaliseFolderTree,
} from '../../lib/library/normalise/folders.ts'
import { pluginClient } from '../../lib/library/pluginClient.ts'
import { requireFeature } from './bootstrap.ts'

// The folder routes (server-api.md §7.11): FileBird's tree through the
// plugin. The plugin enforces FileBird's own rules (active, per-user mode,
// cycles, Pro); the server validates shapes and limits first.

export const foldersRouter = Router()

foldersRouter.use('/folders', requireFeature('folders'))

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function folderName(value: unknown): string {
  if (typeof value !== 'string') {
    throw invalidRequest('name', 'name must be a string.')
  }
  const name = normaliseFolderName(value)
  if (name.length === 0) {
    throw invalidRequest('name', 'name must not be empty.')
  }
  if (characters(name) > LIMITS.folderNameLength) {
    throw invalidRequest(
      'name',
      `name: at most ${LIMITS.folderNameLength} characters.`,
    )
  }
  return name
}

/** A folder id where 0 means top level / Uncategorized. */
function folderRef(value: unknown, param: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw invalidRequest(param, `${param} must be 0 or a folder id.`)
  }
  return value
}

function position(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw invalidRequest('position', 'position must be a whole number ≥ 0.')
  }
  return value
}

function color(value: unknown): string | null {
  if (value === null) return null
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) {
    throw invalidRequest('color', 'color must be #rrggbb or null.')
  }
  return value.toLowerCase()
}

function sendMutation(res: Response, status: number, body: { rev: string }) {
  sendNoStore(res, body, { status, rev: body.rev })
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

foldersRouter.get(
  '/folders',
  asyncRoute(async (req, res) => {
    queryParams(req, [])
    await serveCachedRead(req, res, 'folders', '', async () =>
      normaliseFolderTree(await pluginClient.folders()),
    )
  }),
)

foldersRouter.post(
  '/folders',
  asyncRoute(async (req, res) => {
    queryParams(req, [])
    const body = objectBody(req)
    rejectUnknownFields(body, ['name', 'parent'])
    if (body.parent === undefined) {
      throw invalidRequest('parent', 'parent is required (0 = top level).')
    }
    const request: FolderCreateRequest = {
      name: folderName(body.name),
      parent: folderRef(body.parent, 'parent'),
    }
    const answer = await pluginClient.createFolder(request)
    sendMutation(res, 201, normaliseFolderMutation(answer))
  }),
)

foldersRouter.post(
  '/folders/assign',
  asyncRoute(async (req, res) => {
    queryParams(req, [])
    const body = objectBody(req)
    rejectUnknownFields(body, ['folder', 'ids'])
    const request: FolderAssignRequest = {
      folder: folderRef(body.folder, 'folder'),
      ids: parseIdArray(body.ids, 'ids', LIMITS.assignIds),
    }
    sendMutation(res, 200, await pluginClient.assignFolder(request))
  }),
)

foldersRouter.patch(
  '/folders/:id',
  asyncRoute(async (req, res) => {
    const id = pathId(req)
    queryParams(req, [])
    const body = objectBody(req)
    rejectUnknownFields(body, ['name', 'parent', 'position', 'color'])
    const request: FolderUpdateRequest = {}
    if (body.name !== undefined) request.name = folderName(body.name)
    if (body.parent !== undefined) {
      request.parent = folderRef(body.parent, 'parent')
    }
    if (body.position !== undefined) request.position = position(body.position)
    if (body.color !== undefined) request.color = color(body.color)
    if (Object.keys(request).length === 0) {
      throw invalidRequest('body', 'Send at least one field to change.')
    }
    const answer = await pluginClient.updateFolder(id, request)
    sendMutation(res, 200, normaliseFolderMutation(answer))
  }),
)

foldersRouter.delete(
  '/folders/:id',
  asyncRoute(async (req, res) => {
    const id = pathId(req)
    queryParams(req, [])
    const answer = await pluginClient.deleteFolder(id)
    sendMutation(res, 200, normaliseFolderDelete(answer))
  }),
)
