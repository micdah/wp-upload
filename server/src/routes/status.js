import { Router } from 'express';
import { env } from '../config/env.js';
import { connectionState } from '../config/wpClient.js';

export const statusRouter = Router();

statusRouter.get('/status', (req, res) => {
  res.json({
    connected: connectionState.connected,
    user: connectionState.user,
    reason: connectionState.reason,
    wpUrl: env.wpUrl,
    maxFileSizeMb: env.maxFileSizeMb,
  });
});
