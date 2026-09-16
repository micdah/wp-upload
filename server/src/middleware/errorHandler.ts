import type { ErrorRequestHandler } from "express"
import multer from "multer"

export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
    res.status(413).json({
      code: "file_too_large",
      message: "File exceeds the configured maximum size (MAX_FILE_SIZE_MB).",
    })
    return
  }

  console.error(err)
  res.status(500).json({
    code: "internal_error",
    message: "Something went wrong on the server.",
  })
}
