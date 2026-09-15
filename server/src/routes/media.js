import fs from 'node:fs';
import os from 'node:os';
import { Router } from 'express';
import multer from 'multer';
import { env } from '../config/env.js';
import { uploadToWordPress } from '../lib/wpUpload.js';

const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: env.maxFileSizeMb * 1024 * 1024 },
});

export const mediaRouter = Router();

mediaRouter.post('/media', (req, res, next) => {
  upload.single('file')(req, res, async (err) => {
    if (err) return next(err);

    if (!req.file) {
      return res.status(400).json({ code: 'no_file', message: 'No file was provided.' });
    }

    try {
      const result = await uploadToWordPress(req.file);
      res.status(201).json(result);
    } catch (wpError) {
      res.status(wpError.status || 502).json({ code: wpError.code, message: wpError.message });
    } finally {
      fs.unlink(req.file.path, () => {});
    }
  });
});
