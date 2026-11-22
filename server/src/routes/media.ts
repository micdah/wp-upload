import os from 'node:os'
import { Router } from 'express'
import multer from 'multer'
import { env } from '../config/env.ts'
import { isFilebirdEnabled } from '../config/filebirdClient.ts'
import { cancelJob, createJob, getJob } from '../lib/uploadJobs.ts'
import {
  findExistingMediaBySlug,
  isWpError,
  upstreamErrorStatus,
} from '../lib/wpUpload.ts'

// multer 2 supports defParamCharset, but @types/multer doesn't declare it yet.
const multerOptions: multer.Options & { defParamCharset: string } = {
  dest: os.tmpdir(),
  limits: { fileSize: env.maxFileSizeMb * 1024 * 1024 },
  // Browsers send filenames as raw UTF-8; multer would decode them as latin1
  // by default, mangling any non-ASCII name before it reaches WordPress.
  defParamCharset: 'utf8',
}

const upload = multer(multerOptions)

// The optional multipart `folderId` field (#38). Anything that isn't a
// positive integer - including 0, FileBird's "Uncategorized" - means "don't
// file it anywhere".
function parseFolderId(value: unknown): number | null {
  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : null
}

export const mediaRouter = Router()

// Lightweight pre-flight check the client runs before queuing an upload, so
// it can warn the user rather than silently creating a same-named duplicate.
// Doesn't touch the upload concurrency gate - it's a single cheap GET, not a
// proxy of the heavy media upload itself.
mediaRouter.get('/media/check', async (req, res, next) => {
  const filename = req.query.filename
  if (typeof filename !== 'string' || !filename) {
    return res
      .status(400)
      .json({ code: 'no_filename', message: 'No filename was provided.' })
  }

  try {
    const matches = await findExistingMediaBySlug(filename)
    res.json({ duplicate: matches.length > 0, matches })
  } catch (wpError) {
    if (!isWpError(wpError)) return next(wpError)
    res
      .status(upstreamErrorStatus(wpError.status))
      .json({ code: wpError.code, message: wpError.message })
  }
})

// Responds as soon as the file is on disk rather than once WordPress has
// processed it - the WordPress upload continues as a background job, which
// the client follows via GET /media/jobs. That frees the browser connection
// for the next file instead of holding it through the (potentially
// minutes-long) thumbnail generation - see #37.
mediaRouter.post('/media', (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) return next(err)

    if (!req.file) {
      return res
        .status(400)
        .json({ code: 'no_file', message: 'No file was provided.' })
    }

    const folderId = isFilebirdEnabled()
      ? parseFolderId(req.body?.folderId)
      : null

    res.status(202).json({ jobId: createJob(req.file, folderId) })
  })
})

// Batched status lookup, so a client polls once for all of its in-flight
// jobs rather than spending one browser connection per job.
mediaRouter.get('/media/jobs', (req, res) => {
  const ids =
    typeof req.query.ids === 'string'
      ? req.query.ids.split(',').filter(Boolean)
      : []
  if (ids.length === 0) {
    return res
      .status(400)
      .json({ code: 'no_ids', message: 'No job ids were provided.' })
  }

  res.json({
    jobs: ids.map((id) => {
      const job = getJob(id)
      if (!job) return { id, status: 'not_found' }
      return {
        id,
        status: job.status,
        ...(job.result && { result: job.result }),
        ...(job.error && {
          error: { code: job.error.code, message: job.error.message },
        }),
      }
    }),
  })
})

mediaRouter.delete('/media/jobs/:id', (req, res) => {
  if (!cancelJob(req.params.id)) {
    return res
      .status(404)
      .json({ code: 'job_not_found', message: 'No such upload job.' })
  }
  res.status(204).end()
})
