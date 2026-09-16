import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../config/serverLoad.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../config/serverLoad.ts')>();
  return { ...actual, getLatestSnapshot: vi.fn() };
});
vi.mock('./media.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./media.ts')>();
  return { ...actual, getActiveUploadCount: vi.fn() };
});

import { getLatestSnapshot } from '../config/serverLoad.ts';
import { getActiveUploadCount } from './media.ts';
import { serverLoadRouter } from './serverLoad.ts';

const SNAPSHOT = {
  timestamp: 1_000,
  cpu: { usagePercent: 12.3 },
  memory: { totalBytes: 100, usedBytes: 40, usedPercent: 40 },
  disk: { mount: '/tmp', totalBytes: 100, usedBytes: 20, usedPercent: 20 },
  network: { iface: 'eth0', rxBytesPerSec: 10, txBytesPerSec: 5 },
  loadAverage: { '1m': 0.1, '5m': 0.2, '15m': 0.3 },
  cpuCount: 4,
};

describe('GET /server-load', () => {
  function buildApp() {
    const app = express();
    app.use(serverLoadRouter);
    return app;
  }

  it('responds 503 while no snapshot has been sampled yet', async () => {
    vi.mocked(getLatestSnapshot).mockReturnValue(null);
    const app = buildApp();

    const res = await request(app).get('/server-load');

    expect(res.status).toBe(503);
  });

  it('returns the latest snapshot merged with live upload concurrency', async () => {
    vi.mocked(getLatestSnapshot).mockReturnValue(SNAPSHOT);
    vi.mocked(getActiveUploadCount).mockReturnValue(3);
    const app = buildApp();

    const res = await request(app).get('/server-load');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ...SNAPSHOT,
      uploads: { active: 3, concurrencyLimit: 8 },
    });
  });
});
