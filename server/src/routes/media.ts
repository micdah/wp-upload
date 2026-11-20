import fs from 'node:fs'
import os from 'node:os'
import { Router } from 'express'
import multer from 'multer'
import { env } from '../config/env.ts'
import { isFilebirdEnabled } from '../config/filebirdClient.ts'
import { assignToFolder } from '../lib/filebird.ts'
import {
  findExistingMediaBySlug,
  isWpError,
  uploadToWordPress,
} from '../lib/wpUpload.ts'

const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: env.maxFileSizeMb * 1024 * 1024 },
})

// Caps how many requests are proxying to WordPress at once, regardless of
// how many parallel requests the client(s) send - protects the WP site from
// a runaway client or multiple browser tabs each running their own limit.
let activeUploads = 0
const waiting: Array<() => void> = []

export function acquireSlot(): Promise<void> {
  if (activeUploads < env.uploadConcurrency) {
    activeUploads++
    return Promise.resolve()
  }
  return new Promise((resolve) => waiting.push(resolve))
}

export function releaseSlot(): void {
  const next = waiting.shift()
  if (next) next()
  else activeUploads--
}

// Read live (not cached) by /api/server-load, since it's cheap and more
// time-sensitive than the periodic OS-metric snapshot.
export function getActiveUploadCount(): number {
  return activeUploads
}

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
// Doesn't touch the upload concurrency gate above - it's a single cheap GET,
// not a proxy of the heavy media upload itself.
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
      .status(wpError.status || 502)
      .json({ code: wpError.code, message: wpError.message })
  }
})

mediaRouter.post('/media', (req, res, next) => {
  upload.single('file')(req, res, async (err) => {
    if (err) return next(err)

    if (!req.file) {
      return res
        .status(400)
        .json({ code: 'no_file', message: 'No file was provided.' })
    }

    const file = req.file
    const folderId = isFilebirdEnabled()
      ? parseFolderId(req.body?.folderId)
      : null

    // Aborts the upstream WordPress request when the client disconnects
    // mid-upload (e.g. cancels in the UI) - without this, the request to
    // WordPress runs to completion regardless, holding a concurrency slot
    // and still creating the media item after the user "cancelled" it.
    // Listening on `res` (not `req`) matters: once multer/busboy has fully
    // consumed the request body, `req` stops receiving further socket
    // lifecycle events, but `res` still reliably emits 'close' if the
    // connection is torn down before the response completes.
    const controller = new AbortController()
    let clientDisconnected = false
    res.on('error', () => {})
    res.on('close', () => {
      if (!res.writableEnded) {
        clientDisconnected = true
        controller.abort()
      }
    })

    await acquireSlot()
    try {
      const result = await uploadToWordPress(file, {
        signal: controller.signal,
      })
      if (clientDisconnected) return
      if (folderId === null) {
        res.status(201).json(result)
        return
      }

      // The media item already exists at this point, so a filing failure
      // must not turn into an upload error (retrying would just create a
      // duplicate) - it's reported alongside the result instead.
      try {
        await assignToFolder(result.id, folderId)
        if (!clientDisconnected) {
          res
            .status(201)
            .json({ ...result, folder: { id: folderId, assigned: true } })
        }
      } catch (folderError) {
        const message = isWpError(folderError)
          ? folderError.message
          : 'Could not file the upload into the FileBird folder.'
        console.error(
          `Uploaded media ${result.id} but could not file it into FileBird folder ${folderId}: ${message}`,
        )
        if (!clientDisconnected) {
          res.status(201).json({
            ...result,
            folder: { id: folderId, assigned: false, message },
          })
        }
      }
    } catch (wpError) {
      if (!isWpError(wpError)) throw wpError
      if (!clientDisconnected) {
        res
          .status(wpError.status || 502)
          .json({ code: wpError.code, message: wpError.message })
      }
    } finally {
      releaseSlot()
      fs.unlink(file.path, (unlinkErr) => {
        if (unlinkErr)
          console.error(
            `Failed to remove temp upload file ${file.path}:`,
            unlinkErr,
          )
      })
    }
  })
})
