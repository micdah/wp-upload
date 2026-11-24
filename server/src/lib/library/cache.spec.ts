import { afterEach, describe, expect, it, vi } from 'vitest'
import { pluginInfo } from '../../../../shared/fixtures/index.ts'
import {
  CACHE_LIMITS,
  cached,
  cacheStats,
  currentRev,
  currentRevState,
  etagFor,
  expireRevPoll,
  lastKnownRev,
  noteRev,
  resetCacheForTests,
} from './cache.ts'
import { pluginClient } from './pluginClient.ts'
import { callsTo, fakeWordPress, plugin } from './specSupport.ts'

afterEach(() => {
  vi.useRealTimers()
  resetCacheForTests()
})

function fakeRev(revs: string[]) {
  let next = 0
  return fakeWordPress({
    [plugin('GET', '/rev')]: () => ({
      rev: revs[Math.min(next++, revs.length - 1)],
      index: pluginInfo.index,
    }),
    [plugin('POST', '/media/trash')]: () => ({
      rev: '900',
      results: [],
      remaining: [],
    }),
  })
}

describe('currentRev', () => {
  it('polls /rev at most every 2 s and shares concurrent polls', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const spy = fakeRev(['100', '101'])

    const [a, b] = await Promise.all([currentRev(), currentRev()])
    expect([a, b]).toEqual(['100', '100'])
    vi.advanceTimersByTime(1999)
    expect(await currentRev()).toBe('100')
    expect(callsTo(spy, plugin('GET', '/rev'))).toHaveLength(1)

    vi.advanceTimersByTime(1)
    expect(await currentRev()).toBe('101')
    expect(callsTo(spy, plugin('GET', '/rev'))).toHaveLength(2)
  })

  it('keeps the index state of the last poll', async () => {
    fakeRev(['100'])
    expect(await currentRevState()).toEqual({
      rev: '100',
      index: pluginInfo.index,
    })
  })

  it('moves forward at once with every plugin response that reports a rev', async () => {
    fakeRev(['100'])
    await currentRev()
    await pluginClient.mediaTrash({ ids: [1] })
    expect(await currentRev()).toBe('900')
  })

  it('never moves back for a response, but follows a poll down', () => {
    noteRev('200', 'response')
    noteRev('150', 'response')
    expect(lastKnownRev()).toBe('200')
    noteRev('150', 'poll')
    expect(lastKnownRev()).toBe('150')
  })

  it('follows a poll down when no write raced it (a restored database)', async () => {
    fakeRev(['150'])
    noteRev('200', 'response')
    expect(await currentRev()).toBe('150')
  })

  it('never lets a poll that raced a mutation move the rev back', async () => {
    let answerPoll: (answer: unknown) => void = () => {}
    fakeWordPress({
      [plugin('GET', '/rev')]: () =>
        new Promise((resolve) => {
          answerPoll = resolve
        }),
      [plugin('POST', '/media/trash')]: () => ({
        rev: '900',
        results: [],
        remaining: [],
      }),
    })
    // The poll asks /rev, the mutation answers while the poll is in flight,
    // and the poll's (older) answer arrives last.
    const polled = currentRev()
    await pluginClient.mediaTrash({ ids: [1] })
    answerPoll({ rev: '100', index: pluginInfo.index })
    expect(await polled).toBe('900')
    expect(lastKnownRev()).toBe('900')
  })

  it('still moves forward with a poll that raced a mutation', async () => {
    let answerPoll: (answer: unknown) => void = () => {}
    fakeWordPress({
      [plugin('GET', '/rev')]: () =>
        new Promise((resolve) => {
          answerPoll = resolve
        }),
      [plugin('POST', '/media/trash')]: () => ({
        rev: '900',
        results: [],
        remaining: [],
      }),
    })
    const polled = currentRev()
    await pluginClient.mediaTrash({ ids: [1] })
    answerPoll({ rev: '901', index: pluginInfo.index })
    expect(await polled).toBe('901')
  })

  it('polls again at once after expireRevPoll (a core REST write)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const spy = fakeRev(['100', '101'])
    expect(await currentRev()).toBe('100')
    expireRevPoll()
    expect(await currentRev()).toBe('101')
    expect(callsTo(spy, plugin('GET', '/rev'))).toHaveLength(2)
    // …and then throttles as before.
    expect(await currentRev()).toBe('101')
    expect(callsTo(spy, plugin('GET', '/rev'))).toHaveLength(2)
  })

  it('does not join, or trust, a poll that started before expireRevPoll', async () => {
    const answers: Array<(answer: unknown) => void> = []
    const spy = fakeWordPress({
      [plugin('GET', '/rev')]: () =>
        new Promise((resolve) => {
          answers.push(resolve)
        }),
    })
    const before = currentRev()
    expireRevPoll()
    const after = currentRev()
    expect(callsTo(spy, plugin('GET', '/rev'))).toHaveLength(2)

    answers[0]?.({ rev: '100', index: pluginInfo.index })
    expect(await before).toBe('100')
    answers[1]?.({ rev: '101', index: pluginInfo.index })
    expect(await after).toBe('101')

    // The stale poll left the next one due; the fresh one counts.
    expect(await currentRev()).toBe('101')
    expect(callsTo(spy, plugin('GET', '/rev'))).toHaveLength(2)
  })

  it('compares revs as numbers, not strings', () => {
    noteRev('999', 'poll')
    noteRev('1000', 'response')
    expect(lastKnownRev()).toBe('1000')
  })
})

describe('cached', () => {
  it('loads once per key and serves the serialised value', async () => {
    const load = vi.fn(async () => ({ rev: '1', n: 1 }))
    const first = await cached('k@1', load)
    const second = await cached('k@1', load)
    expect(load).toHaveBeenCalledOnce()
    expect(second.body).toBe(first.body)
    expect(first.body.toString('utf8')).toBe('{"rev":"1","n":1}')
    expect(first.rev).toBe('1')
    expect(second.value()).toEqual({ rev: '1', n: 1 })
    // Every caller gets its own copy of the value.
    expect(second.value()).not.toBe(second.value())
  })

  it('keeps only the UTF-8 JSON, and counts it against the budget', async () => {
    const value = { rev: '7', title: 'æøå 😀' }
    const answer = await cached('k@7', async () => value)
    const json = JSON.stringify(value)
    expect(Buffer.isBuffer(answer.body)).toBe(true)
    expect(answer.body.byteLength).toBe(Buffer.byteLength(json))
    // Counted as the body's bytes (not UTF-16 units) plus the key and a
    // small per-entry overhead.
    const { bytes } = cacheStats()
    expect(bytes).toBeGreaterThanOrEqual(Buffer.byteLength(json) + 5)
    expect(bytes).toBeLessThan(Buffer.byteLength(json) + 1024)
    expect(answer.value()).toEqual(value)
    expect(answer.value()).not.toBe(value)
  })

  it('has no rev for values without one', async () => {
    expect((await cached('k', async () => [1, 2])).rev).toBeNull()
  })

  it('shares one load between concurrent misses (single-flight)', async () => {
    let release: (value: { n: number }) => void = () => {}
    const load = vi.fn(
      () =>
        new Promise<{ n: number }>((resolve) => {
          release = resolve
        }),
    )
    const both = Promise.all([cached('k', load), cached('k', load)])
    release({ n: 2 })
    const [a, b] = await both
    expect(load).toHaveBeenCalledOnce()
    expect(a.body).toBe(b.body)
  })

  it('never caches failures', async () => {
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValueOnce({ ok: true })
    await expect(cached('k', load)).rejects.toThrow('down')
    expect((await cached('k', load)).value()).toEqual({ ok: true })
  })

  it('expires entries after the TTL', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const load = vi.fn(async () => ({ n: 1 }))
    await cached('k', load)
    vi.advanceTimersByTime(CACHE_LIMITS.ttlMs - 1)
    await cached('k', load)
    expect(load).toHaveBeenCalledOnce()
    vi.advanceTimersByTime(1)
    await cached('k', load)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('evicts the least recently used entry beyond 200 entries', async () => {
    for (let i = 0; i < CACHE_LIMITS.maxEntries; i++) {
      await cached(`k${i}`, async () => i)
    }
    // Touch k0, so k1 is now the least recently used.
    await cached('k0', async () => -1)
    await cached('new', async () => 'new')
    expect(cacheStats().entries).toBe(CACHE_LIMITS.maxEntries)

    const reload = vi.fn(async () => 'reloaded')
    await cached('k0', reload)
    expect(reload).not.toHaveBeenCalled()
    await cached('k1', reload)
    expect(reload).toHaveBeenCalledOnce()
  })

  it('evicts by size beyond 64 MB', async () => {
    const big = 'x'.repeat(30 * 1024 * 1024)
    await cached('a', async () => big)
    await cached('b', async () => big)
    await cached('c', async () => big)
    expect(cacheStats().entries).toBe(2)
    expect(cacheStats().bytes).toBeLessThanOrEqual(CACHE_LIMITS.maxBytes)
  })
})

describe('etagFor', () => {
  it('is weak, carries the rev, and depends on the query', () => {
    const tag = etagFor('1795867200000', 'collection?folder=0')
    expect(tag).toMatch(/^W\/"1795867200000-[A-Za-z0-9_-]{16}"$/)
    expect(etagFor('1795867200000', 'collection?folder=1')).not.toBe(tag)
    expect(etagFor('1795867200001', 'collection?folder=0')).not.toBe(tag)
  })
})
