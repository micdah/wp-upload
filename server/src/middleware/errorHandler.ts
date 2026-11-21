import type { ErrorRequestHandler } from 'express'
import multer from 'multer'

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({
        code: 'file_too_large',
        message: 'File exceeds the configured maximum size (MAX_FILE_SIZE_MB).',
      })
      return
    }

    res.status(400).json({ code: 'upload_error', message: err.message })
    return
  }

  // Raised by express.json() (e.g. on POST /api/folders) for a malformed body.
  if (err?.type === 'entity.parse.failed') {
    res.status(400).json({
      code: 'invalid_json',
      message: 'Request body is not valid JSON.',
    })
    return
  }

  // Other client-caused body-parser errors (e.g. an oversized or wrongly
  // encoded body on the public login endpoint): answer with their 4xx status
  // instead of logging a stack trace that anyone could trigger.
  if (
    typeof err?.type === 'string' &&
    err.expose === true &&
    Number.isInteger(err.status) &&
    err.status >= 400 &&
    err.status < 500
  ) {
    res.status(err.status).json({
      code: 'invalid_request_body',
      message: err.message,
    })
    return
  }

  console.error(err)
  res.status(500).json({
    code: 'internal_error',
    message: 'Something went wrong on the server.',
  })
}
