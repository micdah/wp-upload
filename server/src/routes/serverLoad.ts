import { Router } from 'express';
import { env } from '../config/env.ts';
import { getLatestSnapshot } from '../config/serverLoad.ts';
import { getActiveUploadCount } from './media.ts';

export const serverLoadRouter = Router();

serverLoadRouter.get('/server-load', (req, res) => {
  const snapshot = getLatestSnapshot();
  if (!snapshot) {
    return res.status(503).json({ error: 'server_load_not_ready' });
  }
  res.json({
    ...snapshot,
    uploads: { active: getActiveUploadCount(), concurrencyLimit: env.uploadConcurrency },
  });
});
