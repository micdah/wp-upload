import os from 'node:os'
import si from 'systeminformation'

export interface ServerLoadSnapshot {
  timestamp: number
  cpu: { usagePercent: number | null }
  memory: { totalBytes: number; usedBytes: number; usedPercent: number } | null
  disk: {
    mount: string
    totalBytes: number
    usedBytes: number
    usedPercent: number
  } | null
  network: {
    iface: string | null
    rxBytesPerSec: number | null
    txBytesPerSec: number | null
  }
  loadAverage: { '1m': number; '5m': number; '15m': number }
  cpuCount: number
}

const SAMPLE_INTERVAL_MS = 5_000 // keep roughly aligned with the client's poll cadence

let latestSnapshot: ServerLoadSnapshot | null = null

// Picks the fsSize() entry mounted on the longest matching prefix of
// os.tmpdir() - that's the filesystem Multer actually writes uploads to
// (see routes/media.ts), and the one that can fill up and break uploads.
// Reporting root disk instead would be misleading on a host where /tmp is
// a separate mount (e.g. tmpfs).
function findTmpdirMount(
  fsSizes: Awaited<ReturnType<typeof si.fsSize>>,
): (typeof fsSizes)[number] | null {
  const tmpdir = os.tmpdir()
  let best: (typeof fsSizes)[number] | null = null
  for (const entry of fsSizes) {
    if (entry.mount && tmpdir.startsWith(entry.mount)) {
      if (!best || entry.mount.length > best.mount.length) best = entry
    }
  }
  return best
}

async function sample(): Promise<void> {
  const [cpuResult, memResult, diskResult, netResult] =
    await Promise.allSettled([
      si.currentLoad(),
      si.mem(),
      si.fsSize(),
      si.networkStats(),
    ])

  const cpu: ServerLoadSnapshot['cpu'] =
    cpuResult.status === 'fulfilled'
      ? { usagePercent: cpuResult.value.currentLoad }
      : (latestSnapshot?.cpu ?? { usagePercent: null })

  let memory: ServerLoadSnapshot['memory'] = latestSnapshot?.memory ?? null
  if (memResult.status === 'fulfilled') {
    const mem = memResult.value
    memory = {
      totalBytes: mem.total,
      usedBytes: mem.active,
      usedPercent: (mem.active / mem.total) * 100,
    }
  } else {
    console.warn('serverLoad: failed to sample memory usage', memResult.reason)
  }

  let disk: ServerLoadSnapshot['disk'] = latestSnapshot?.disk ?? null
  if (diskResult.status === 'fulfilled') {
    const match = findTmpdirMount(diskResult.value)
    disk = match
      ? {
          mount: match.mount,
          totalBytes: match.size,
          usedBytes: match.used,
          usedPercent: match.use,
        }
      : null
  } else {
    console.warn('serverLoad: failed to sample disk usage', diskResult.reason)
  }

  let network: ServerLoadSnapshot['network'] = latestSnapshot?.network ?? {
    iface: null,
    rxBytesPerSec: null,
    txBytesPerSec: null,
  }
  if (netResult.status === 'fulfilled') {
    const iface = netResult.value[0]
    network = iface
      ? {
          iface: iface.iface,
          rxBytesPerSec: iface.rx_sec,
          txBytesPerSec: iface.tx_sec,
        }
      : { iface: null, rxBytesPerSec: null, txBytesPerSec: null }
  } else {
    console.warn(
      'serverLoad: failed to sample network throughput',
      netResult.reason,
    )
  }

  if (cpuResult.status === 'rejected')
    console.warn('serverLoad: failed to sample CPU usage', cpuResult.reason)

  const loadavg = os.loadavg()

  latestSnapshot = {
    timestamp: Date.now(),
    cpu,
    memory,
    disk,
    network,
    loadAverage: {
      '1m': loadavg[0] ?? 0,
      '5m': loadavg[1] ?? 0,
      '15m': loadavg[2] ?? 0,
    },
    cpuCount: os.cpus().length,
  }
}

export function startServerLoadSampler(): void {
  setInterval(() => {
    sample().catch((err) =>
      console.error('serverLoad: unexpected sampling failure', err),
    )
  }, SAMPLE_INTERVAL_MS)
}

export function getLatestSnapshot(): ServerLoadSnapshot | null {
  return latestSnapshot
}

// Exported for the server startup sequence, which samples once synchronously
// before accepting requests so the first /api/server-load call never 503s.
export const sampleOnce = sample
