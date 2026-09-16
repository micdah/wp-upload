import { Router } from 'express';
import { env } from '../config/env.ts';
import { connectionState, refreshConnectionIfStale } from '../config/wpClient.ts';

export const statusRouter = Router();

statusRouter.get('/status', (req, res) => {
  refreshConnectionIfStale();
  res.json({
    connected: connectionState.connected,
    user: connectionState.user,
    reason: connectionState.reason,
    wpUrl: env.wpUrl,
    maxFileSizeMb: env.maxFileSizeMb,
    uploadConcurrency: env.uploadConcurrency,
  });
});
