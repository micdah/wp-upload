import multer from 'multer';

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      code: 'file_too_large',
      message: 'File exceeds the configured maximum size (MAX_FILE_SIZE_MB).',
    });
  }

  console.error(err);
  res.status(500).json({ code: 'internal_error', message: 'Something went wrong on the server.' });
}
