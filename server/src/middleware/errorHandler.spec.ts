import type { Request, Response } from 'express'
import multer from 'multer'
import { describe, expect, it, vi } from 'vitest'
import { errorHandler } from './errorHandler.ts'

function createRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  }
}

// Fully synchronous end-to-end (errorHandler never awaits), and each test
// builds its own local req/res/console spy, so concurrent execution is safe.
describe.concurrent('errorHandler', () => {
  it('maps a Multer file-size error to 413', () => {
    const res = createRes()
    const err = new multer.MulterError('LIMIT_FILE_SIZE')

    errorHandler(err, {} as Request, res as unknown as Response, vi.fn())

    expect(res.status).toHaveBeenCalledWith(413)
    expect(res.json).toHaveBeenCalledWith({
      code: 'file_too_large',
      message: 'File exceeds the configured maximum size (MAX_FILE_SIZE_MB).',
    })
  })

  it('maps any other error to a generic 500 and logs it', () => {
    const res = createRes()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const err = new Error('boom')

    errorHandler(err, {} as Request, res as unknown as Response, vi.fn())

    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({
      code: 'internal_error',
      message: 'Something went wrong on the server.',
    })
    expect(consoleError).toHaveBeenCalledWith(err)
  })

  it('maps a non-file-size Multer error to a 400 upload error', () => {
    const res = createRes()
    const err = new multer.MulterError('LIMIT_UNEXPECTED_FILE')

    errorHandler(err, {} as Request, res as unknown as Response, vi.fn())

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({
      code: 'upload_error',
      message: err.message,
    })
  })

  it('maps an express.json() parse failure to a 400', () => {
    const res = createRes()
    const err = Object.assign(new SyntaxError('Unexpected token'), {
      type: 'entity.parse.failed',
    })

    errorHandler(err, {} as Request, res as unknown as Response, vi.fn())

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({
      code: 'invalid_json',
      message: 'Request body is not valid JSON.',
    })
  })

  it('maps other client-caused body-parser errors to their 4xx status without logging', () => {
    const res = createRes()
    // spyOn hands back the spy an earlier test left on console.error, along
    // with its calls, so start from a clean slate.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    consoleError.mockClear()
    const err = Object.assign(new Error('request entity too large'), {
      type: 'entity.too.large',
      status: 413,
      expose: true,
    })

    errorHandler(err, {} as Request, res as unknown as Response, vi.fn())

    expect(res.status).toHaveBeenCalledWith(413)
    expect(res.json).toHaveBeenCalledWith({
      code: 'invalid_request_body',
      message: 'request entity too large',
    })
    expect(consoleError).not.toHaveBeenCalled()
  })
})
