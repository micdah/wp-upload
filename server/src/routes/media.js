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

// Caps how many requests are proxying to WordPress at once, regardless of
// how many parallel requests the client(s) send - protects the WP site from
// a runaway client or multiple browser tabs each running their own limit.
let activeUploads = 0;
const waiting = [];

function acquireSlot() {
  if (activeUploads < env.uploadConcurrency) {
    activeUploads++;
    return Promise.resolve();
  }
  return new Promise((resolve) => waiting.push(resolve));
}

function releaseSlot() {
  const next = waiting.shift();
  if (next) next();
  else activeUploads--;
}

export const mediaRouter = Router();

mediaRouter.post('/media', (req, res, next) => {
  upload.single('file')(req, res, async (err) => {
    if (err) return next(err);

    if (!req.file) {
      return res.status(400).json({ code: 'no_file', message: 'No file was provided.' });
    }

    await acquireSlot();
    try {
      const result = await uploadToWordPress(req.file);
      res.status(201).json(result);
    } catch (wpError) {
      res.status(wpError.status || 502).json({ code: wpError.code, message: wpError.message });
    } finally {
      releaseSlot();
      fs.unlink(req.file.path, () => {});
    }
  });
});
