import type { Request } from "express"
import multer from "multer"
import { describe, expect, it, vi } from "vitest"
import { errorHandler } from "./errorHandler.ts"

function createRes() {
  const res: any = {}
  res.status = vi.fn().mockReturnValue(res)
  res.json = vi.fn().mockReturnValue(res)
  return res
}

// Fully synchronous end-to-end (errorHandler never awaits), and each test
// builds its own local req/res/console spy, so concurrent execution is safe.
describe.concurrent("errorHandler", () => {
  it("maps a Multer file-size error to 413", () => {
    const res = createRes()
    const err = new multer.MulterError("LIMIT_FILE_SIZE")

    errorHandler(err, {} as Request, res, vi.fn())

    expect(res.status).toHaveBeenCalledWith(413)
    expect(res.json).toHaveBeenCalledWith({
      code: "file_too_large",
      message: "File exceeds the configured maximum size (MAX_FILE_SIZE_MB).",
    })
  })

  it("maps any other error to a generic 500 and logs it", () => {
    const res = createRes()
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    const err = new Error("boom")

    errorHandler(err, {} as Request, res, vi.fn())

    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({
      code: "internal_error",
      message: "Something went wrong on the server.",
    })
    expect(consoleError).toHaveBeenCalledWith(err)
  })

  it("maps a non-file-size Multer error to a generic 500", () => {
    const res = createRes()
    vi.spyOn(console, "error").mockImplementation(() => {})
    const err = new multer.MulterError("LIMIT_UNEXPECTED_FILE")

    errorHandler(err, {} as Request, res, vi.fn())

    expect(res.status).toHaveBeenCalledWith(500)
  })
})
