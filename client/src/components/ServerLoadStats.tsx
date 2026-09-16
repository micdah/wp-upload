import { Box, Group, RingProgress, Text } from '@mantine/core'
import { useEffect, useRef, useState } from 'react'

const POLL_INTERVAL_MS = 5_000
const STALE_AFTER_MS = POLL_INTERVAL_MS * 3
const FETCH_TIMEOUT_MS = 4_000

interface ServerLoadResponse {
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
  uploads: { active: number; concurrencyLimit: number }
}

type ChipColor = 'teal' | 'yellow' | 'red' | 'gray'

function colorForPercent(percent: number): ChipColor {
  if (percent > 90) return 'red'
  if (percent > 70) return 'yellow'
  return 'teal'
}

function formatBytesPerSec(value: number | null): string {
  if (value === null) return '–'
  if (value < 1024) return `${value.toFixed(0)} B/s`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB/s`
  return `${(value / (1024 * 1024)).toFixed(1)} MB/s`
}

interface Chip {
  key: string
  label: string
  color: ChipColor
  hideOnNarrow?: boolean
}

// Each ring keeps one fixed identity color so CPU/Mem/Disk stay visually
// distinct at a glance - usage level is conveyed by how full the ring is
// and by its numeric label, not by a severity color swap.
const RING_COLOR = { cpu: 'cyan', mem: 'grape', disk: 'orange' } as const

interface RingMetric {
  key: keyof typeof RING_COLOR
  label: string
  percent: number
  color: string
}

function buildRingMetrics(
  data: ServerLoadResponse,
  stale: boolean,
): RingMetric[] {
  const metrics: RingMetric[] = []

  if (data.cpu.usagePercent !== null) {
    metrics.push({
      key: 'cpu',
      label: 'CPU',
      percent: data.cpu.usagePercent,
      color: stale ? 'gray' : RING_COLOR.cpu,
    })
  }
  if (data.memory) {
    metrics.push({
      key: 'mem',
      label: 'MEM',
      percent: data.memory.usedPercent,
      color: stale ? 'gray' : RING_COLOR.mem,
    })
  }
  if (data.disk) {
    metrics.push({
      key: 'disk',
      label: 'DISK',
      percent: data.disk.usedPercent,
      color: stale ? 'gray' : RING_COLOR.disk,
    })
  }

  return metrics
}

function buildChips(data: ServerLoadResponse, stale: boolean): Chip[] {
  const dim = (color: ChipColor): ChipColor => (stale ? 'gray' : color)

  const chips: Chip[] = []

  chips.push({
    key: 'uploads',
    label: `Uploads ${data.uploads.active}/${data.uploads.concurrencyLimit}`,
    color: dim('teal'),
  })

  const loadPercent = (data.loadAverage['1m'] / data.cpuCount) * 100
  chips.push({
    key: 'load',
    label: `Load ${data.loadAverage['1m'].toFixed(1)} / ${data.loadAverage['5m'].toFixed(1)} / ${data.loadAverage['15m'].toFixed(1)}`,
    color: dim(colorForPercent(loadPercent)),
    hideOnNarrow: true,
  })

  chips.push({
    key: 'net',
    label: `↓${formatBytesPerSec(data.network.rxBytesPerSec)} ↑${formatBytesPerSec(data.network.txBytesPerSec)}`,
    color: dim('gray'),
    hideOnNarrow: true,
  })

  return chips
}

export function ServerLoadStats() {
  const [data, setData] = useState<ServerLoadResponse | null>(null)
  const inFlight = useRef(false)

  useEffect(() => {
    let cancelled = false

    const poll = () => {
      if (inFlight.current) return
      inFlight.current = true

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

      fetch('/api/server-load', { signal: controller.signal })
        .then((res) => (res.ok ? res.json() : null))
        .then((json: ServerLoadResponse | null) => {
          if (cancelled || !json) return
          setData(json)
        })
        .catch(() => {
          // Keep showing the last known snapshot; staleness rendering below
          // makes it clear the data may be out of date.
        })
        .finally(() => {
          clearTimeout(timeoutId)
          inFlight.current = false
        })
    }

    poll()
    const intervalId = setInterval(poll, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(intervalId)
    }
  }, [])

  if (!data) return null

  const stale = Date.now() - data.timestamp > STALE_AFTER_MS
  const ringMetrics = buildRingMetrics(data, stale)
  const chips = buildChips(data, stale)

  return (
    <>
      {ringMetrics.map((metric) => (
        <Group key={metric.key} gap={6} wrap='nowrap'>
          <RingProgress
            size={30}
            thickness={4}
            roundCaps
            rootColor='var(--mantine-color-dark-4)'
            transitionDuration={300}
            sections={[
              { value: Math.min(metric.percent, 100), color: metric.color },
            ]}
            label={
              <Text size='9px' fw={700} ta='center' c='dimmed'>
                {metric.percent.toFixed(0)}
              </Text>
            }
          />
          <Text size='xs' c='dimmed' style={{ whiteSpace: 'nowrap' }}>
            {metric.label}
          </Text>
        </Group>
      ))}
      {chips.map((chip) => (
        <Group
          key={chip.key}
          gap={4}
          wrap='nowrap'
          visibleFrom={chip.hideOnNarrow ? 'sm' : undefined}
        >
          <Box
            w={7}
            h={7}
            bg={chip.color}
            style={{ borderRadius: '50%', flexShrink: 0 }}
          />
          <Text size='xs' c='dimmed' style={{ whiteSpace: 'nowrap' }}>
            {chip.label}
          </Text>
        </Group>
      ))}
    </>
  )
}
