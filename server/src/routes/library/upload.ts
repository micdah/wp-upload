import { Router } from 'express'
import {
  type FolderAssignment,
  type JobAccepted,
  LIMITS,
  type UploadCheckResponse,
  type UploadJobResult,
} from '../../../../shared/library-api.ts'
import {
  expireRevPoll,
  knownPluginInfo,
  sendNoStore,
} from '../../lib/library/cache.ts'
import {
  asyncRoute,
  characters,
  invalidRequest,
  LibraryError,
  queryParams,
  toLibraryError,
} from '../../lib/library/errors.ts'
import {
  cancelUploadJob,
  type JobContext,
  multipartFileBody,
  readBack,
  receiveFile,
  removeTempFile,
  startJob,
} from '../../lib/library/jobs.ts'
import {
  MEDIA_FIELDS,
  type WpMedia,
} from '../../lib/library/normalise/items.ts'
import { toDuplicateMatches } from '../../lib/library/normalise/upload.ts'
import {
  pluginClient,
  TIMEOUTS,
  wpCall,
  wpGet,
} from '../../lib/library/pluginClient.ts'
import { type FileInto, fileIntoFolder } from '../../lib/uploadJobs.ts'
import { filenameToSlug } from '../../lib/wpUpload.ts'
import { jobsResponse } from './jobs.ts'

// Uploads (server-api.md §7.15). The browser's request ends as soon as the
// file is on the server's disk (202 + job id); a background job then streams
// it to WordPress, files it into its folder through the companion plugin,
// and reads the new item back. Same model as the legacy upload page
// (uploadJobs.ts), with the media manager's job states and results.

export const uploadRouter = Router()

// ---------------------------------------------------------------------------
// POST upload
// ---------------------------------------------------------------------------

/** The `folder` field: absent, empty or `0` means Uncategorized (null). */
export function parseFolderField(raw: unknown): number | null {
  if (raw === undefined || raw === '' || raw === '0') return null
  if (typeof raw !== 'string' || !/^[1-9][0-9]{0,15}$/.test(raw)) {
    throw invalidRequest(
      'folder',
      'folder must be a folder id (a non-negative integer).',
    )
  }
  return Number(raw)
}

/** What WordPress answers to `POST /wp/v2/media` (only what we read). */
interface WpCreatedMedia {
  id: number
}

/**
 * Files a new item through the plugin's `POST /folders/assign` (spike X6:
 * not `?fbv=`, which files into folders that don't exist). Throws a
 * `{status, code, message}` error that fileIntoFolder() reports.
 */
const fileIntoViaPlugin: FileInto = async (mediaId, folderId) => {
  let answer: Awaited<ReturnType<typeof pluginClient.assignFolder>>
  try {
    answer = await pluginClient.assignFolder({
      folder: folderId,
      ids: [mediaId],
    })
  } catch (err) {
    const { status, body } = toLibraryError(err)
    throw new LibraryError(status, body.code, body.message)
  }
  const skipped = answer.skipped[0]
  if (skipped) {
    throw new LibraryError(409, skipped.error.code, skipped.error.message)
  }
}

/**
 * Whether to file into `folderId` at all, from the last `/info`: without
 * active FileBird the field is ignored (null), and in per-user mode filing
 * is skipped and reported as not assigned (server-api.md §7.15).
 */
async function fileUpload(
  mediaId: number,
  folderId: number | null,
): Promise<FolderAssignment | null> {
  if (folderId === null) return null
  const filebird = knownPluginInfo()?.info.filebird
  if (filebird === null || filebird?.active === false) return null
  if (filebird?.perUser) {
    return {
      id: folderId,
      assigned: false,
      message:
        'FileBird is in per-user mode, where the app can’t file uploads into folders.',
    }
  }
  const outcome = await fileIntoFolder(mediaId, folderId, fileIntoViaPlugin)
  return outcome.assigned
    ? { id: folderId, assigned: true, message: null }
    : { id: folderId, assigned: false, message: outcome.message }
}

/** The upload job: send the bytes, file the item, read it back. */
async function runUpload(
  file: Express.Multer.File,
  folderId: number | null,
  context: JobContext,
): Promise<UploadJobResult> {
  const body = multipartFileBody(
    file,
    {},
    {
      onProgress: (done, total) =>
        context.setProgress({ done, total, unit: 'bytes' }),
      onSent: () => context.setProcessing(),
    },
  )
  let created: WpCreatedMedia
  try {
    created = await wpCall<WpCreatedMedia>({
      method: 'POST',
      path: '/wp-json/wp/v2/media',
      data: body.body,
      headers: {
        'Content-Type': body.contentType,
        'Content-Length': body.contentLength,
      },
      // WordPress may need minutes for the sub-sizes: idle timeout only.
      timeoutMs: TIMEOUTS.long,
      timeoutKind: 'idle',
      signal: context.signal,
    })
  } finally {
    // Closes the temp file if the request failed part-way.
    body.body.destroy()
  }
  // Core's answer carries no library rev: the next cached read (collection,
  // facets, …) must poll `/rev` to see the new item (server-api.md §3.1).
  expireRevPoll()

  // The item exists from here on: filing and reading back never fail the
  // upload in a way that invites a retry (see readBack).
  const folder = await fileUpload(created.id, folderId)
  const item = await readBack(created.id, 'tile')
  return { item, folder }
}

uploadRouter.post('/upload', (req, res, next) => {
  try {
    queryParams(req, [])
  } catch (err) {
    next(err)
    return
  }
  receiveFile(req, res, (err) => {
    if (err) {
      next(err)
      return
    }
    const file = req.file
    if (!file) {
      next(new LibraryError(400, 'upload_error', 'No file was provided.'))
      return
    }
    let folderId: number | null
    try {
      folderId = parseFolderField(req.body?.folder)
    } catch (validationError) {
      removeTempFile(file.path)
      next(validationError)
      return
    }

    const jobId = startJob(
      {
        kind: 'upload',
        filename: file.originalname || 'upload',
        run: (context) => runUpload(file, folderId, context),
      },
      () => removeTempFile(file.path),
    )
    const answer: JobAccepted = { jobId }
    sendNoStore(res, answer, { status: 202 })
  })
})

// ---------------------------------------------------------------------------
// Upload jobs
// ---------------------------------------------------------------------------

uploadRouter.get(
  '/upload/jobs',
  asyncRoute(async (req, res) => {
    sendNoStore(res, jobsResponse(req, ['upload']))
  }),
)

uploadRouter.delete(
  '/upload/jobs/:id',
  asyncRoute(async (req, res) => {
    queryParams(req, [])
    if (!cancelUploadJob(String(req.params.id))) {
      throw new LibraryError(
        404,
        'job_not_found',
        'No such upload job (it is unknown or already finished).',
      )
    }
    res.setHeader('Cache-Control', 'no-store')
    res.status(204).end()
  }),
)

// ---------------------------------------------------------------------------
// GET upload/check
// ---------------------------------------------------------------------------

uploadRouter.get(
  '/upload/check',
  asyncRoute(async (req, res) => {
    const raw = queryParams(req, ['filename'])
    const filename = raw.filename
    if (filename === undefined || characters(filename) > 255) {
      throw invalidRequest('filename', 'filename must be 1–255 characters.')
    }

    // Best effort, as the legacy check (wpUpload.ts findExistingMediaBySlug):
    // WordPress gives an upload the slug of its file name.
    const slug = filenameToSlug(filename)
    let media: unknown = []
    if (slug) {
      media = await wpGet<unknown>('/wp/v2/media', {
        slug,
        per_page: LIMITS.duplicateMatches,
        context: 'view',
        _fields: MEDIA_FIELDS.tile.join(','),
      })
    }
    if (!Array.isArray(media)) {
      throw new LibraryError(
        502,
        'wp_unexpected_response',
        'WordPress answered the duplicate check with an unexpected response.',
      )
    }
    const matches = toDuplicateMatches(media as WpMedia[])
    const body: UploadCheckResponse = {
      duplicate: matches.length > 0,
      matches,
    }
    sendNoStore(res, body)
  }),
)
