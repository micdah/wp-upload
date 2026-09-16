import fs from 'node:fs'
import os from 'node:os'
import { Router } from 'express'
import multer from 'multer'
import { env } from '../config/env.ts'
import { isWpError, uploadToWordPress } from '../lib/wpUpload.ts'

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

export const mediaRouter = Router()

mediaRouter.post('/media', (req, res, next) => {
  upload.single('file')(req, res, async (err) => {
    if (err) return next(err)

    if (!req.file) {
      return res
        .status(400)
        .json({ code: 'no_file', message: 'No file was provided.' })
    }

    const file = req.file

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
      if (!clientDisconnected) res.status(201).json(result)
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
