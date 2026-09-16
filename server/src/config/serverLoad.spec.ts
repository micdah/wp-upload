import os from 'node:os';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import si from 'systeminformation';

vi.mock('systeminformation', () => ({
  default: {
    currentLoad: vi.fn(),
    mem: vi.fn(),
    fsSize: vi.fn(),
    networkStats: vi.fn(),
  },
}));

import { sampleOnce, getLatestSnapshot } from './serverLoad.ts';

const FIXED_LOADAVG: [number, number, number] = [0.5, 0.8, 1.1];

function mockGoodSamples() {
  vi.mocked(si.currentLoad).mockResolvedValue({ currentLoad: 42 } as any);
  vi.mocked(si.mem).mockResolvedValue({ total: 1000, active: 400 } as any);
  vi.mocked(si.fsSize).mockResolvedValue([
    { mount: '/', size: 5000, used: 1000, use: 20 },
    { mount: '/tmp', size: 2000, used: 500, use: 25 },
  ] as any);
  vi.mocked(si.networkStats).mockResolvedValue([{ iface: 'eth0', rx_sec: 100, tx_sec: 50 }] as any);
}

// Plain describe: sample() mutates the module-level `latestSnapshot`
// singleton read back via getLatestSnapshot(), so concurrent ticks/tests
// would race on that shared state.
describe('serverLoad', () => {
  beforeEach(() => {
    vi.spyOn(os, 'loadavg').mockReturnValue(FIXED_LOADAVG);
    vi.spyOn(os, 'cpus').mockReturnValue(new Array(4).fill({}) as any);
    vi.spyOn(os, 'tmpdir').mockReturnValue('/tmp');
  });

  it('builds a snapshot from all sampled metrics, picking the fsSize entry matching tmpdir', async () => {
    mockGoodSamples();

    await sampleOnce();
    const snapshot = getLatestSnapshot();

    expect(snapshot).toMatchObject({
      cpu: { usagePercent: 42 },
      memory: { totalBytes: 1000, usedBytes: 400, usedPercent: 40 },
      disk: { mount: '/tmp', totalBytes: 2000, usedBytes: 500, usedPercent: 25 },
      network: { iface: 'eth0', rxBytesPerSec: 100, txBytesPerSec: 50 },
      loadAverage: { '1m': 0.5, '5m': 0.8, '15m': 1.1 },
      cpuCount: 4,
    });
  });

  it('keeps the previous value for a metric that fails to sample, without clobbering the others', async () => {
    mockGoodSamples();
    await sampleOnce();

    vi.mocked(si.mem).mockRejectedValue(new Error('boom'));
    vi.mocked(si.currentLoad).mockResolvedValue({ currentLoad: 77 } as any);
    await sampleOnce();

    const snapshot = getLatestSnapshot();
    expect(snapshot?.cpu.usagePercent).toBe(77);
    expect(snapshot?.memory).toMatchObject({ totalBytes: 1000, usedBytes: 400, usedPercent: 40 });
  });

  it('reports disk as null when no fsSize entry matches tmpdir', async () => {
    vi.mocked(si.currentLoad).mockResolvedValue({ currentLoad: 1 } as any);
    vi.mocked(si.mem).mockResolvedValue({ total: 1000, active: 100 } as any);
    vi.mocked(si.fsSize).mockResolvedValue([{ mount: '/mnt/other', size: 1, used: 1, use: 1 }] as any);
    vi.mocked(si.networkStats).mockResolvedValue([]);

    await sampleOnce();

    expect(getLatestSnapshot()?.disk).toBeNull();
  });
});
