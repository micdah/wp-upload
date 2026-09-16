import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../config/wpClient.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../config/wpClient.ts')>();
  return { ...actual, refreshConnectionIfStale: vi.fn() };
});

import { connectionState, refreshConnectionIfStale } from '../config/wpClient.ts';
import { statusRouter } from './status.ts';

// Plain describe: both tests read/reset the shared `connectionState` object
// and assert on the shared `refreshConnectionIfStale` spy across a real
// (async) supertest request cycle.
describe('GET /status', () => {
  function buildApp() {
    const app = express();
    app.use(statusRouter);
    return app;
  }

  beforeEach(() => {
    Object.assign(connectionState, { connected: true, user: 'Jane', reason: null, lastCheckedAt: Date.now() });
  });

  it('returns the current connection state and config', async () => {
    const app = buildApp();

    const res = await request(app).get('/status');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      connected: true,
      user: 'Jane',
      reason: null,
      wpUrl: 'https://example.invalid',
    });
  });

  it('triggers a stale-refresh check on every request', async () => {
    const app = buildApp();

    await request(app).get('/status');

    expect(refreshConnectionIfStale).toHaveBeenCalledTimes(1);
  });
});
