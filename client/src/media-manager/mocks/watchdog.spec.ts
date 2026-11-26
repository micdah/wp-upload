// The watchdog's decisions (watchdog.ts): which responses are worth a ping,
// what a ping says, when to reload, and the reload-loop guard.

import { describe, expect, it, vi } from 'vitest'
import {
  ALIVE_HEADER,
  classifyPing,
  createWatchdog,
  decideRecovery,
  isBackendPath,
  isRestartNoticeDue,
  isSuspicious,
  PING_PATH,
  PING_REUSE_MS,
  parseRecoveryRecord,
  RELOAD_COOLDOWN_MS,
  UNHANDLED_HEADER,
} from './watchdog'

const BASE = 'https://example.com/wp-upload-mock/'

function json(status: number, headers: Record<string, string> = {}) {
  return new Response('{}', {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

function html() {
  return new Response('<!doctype html>', {
    status: 200,
    headers: { 'Content-Type': 'text/html' },
  })
}

function alive() {
  return new Response(null, {
    status: 204,
    headers: { [ALIVE_HEADER]: 'alive' },
  })
}

describe('isBackendPath', () => {
  it('matches api/ and session under any mount path', () => {
    expect(isBackendPath('/api/library/rev')).toBe(true)
    expect(isBackendPath('/wp-upload-mock/api/library/items')).toBe(true)
    expect(isBackendPath('/session')).toBe(true)
    expect(isBackendPath('/wp-upload/session')).toBe(true)
  })

  it('leaves the page, assets and source files alone', () => {
    expect(isBackendPath('/')).toBe(false)
    expect(isBackendPath('/wp-upload-mock/')).toBe(false)
    expect(isBackendPath('/assets/index-abc.js')).toBe(false)
    expect(isBackendPath('/src/media-manager/core/data/api.ts')).toBe(false)
    expect(isBackendPath('/src/lib/session.ts')).toBe(false)
    expect(isBackendPath('/mock-media/1/full/a.jpg')).toBe(false)
  })
})

describe('isSuspicious', () => {
  it("flags the dev server's 503, HTML and any 5xx", () => {
    expect(isSuspicious(json(503, { [UNHANDLED_HEADER]: '1' }))).toBe(true)
    expect(isSuspicious(json(200, { [UNHANDLED_HEADER]: '1' }))).toBe(true)
    expect(isSuspicious(html())).toBe(true)
    expect(isSuspicious(json(502))).toBe(true)
  })

  it('trusts ordinary mock answers', () => {
    expect(isSuspicious(json(200))).toBe(false)
    expect(isSuspicious(json(401))).toBe(false)
    expect(isSuspicious(json(404))).toBe(false)
    expect(isSuspicious(new Response(null, { status: 204 }))).toBe(false)
  })
})

describe('classifyPing', () => {
  it('is alive only with the mock header', () => {
    expect(classifyPing(alive())).toBe('alive')
    expect(classifyPing(html())).toBe('bypassed')
    expect(classifyPing(json(503, { [UNHANDLED_HEADER]: '1' }))).toBe(
      'bypassed',
    )
    expect(classifyPing(null)).toBe('unknown')
  })
})

describe('the reload guard', () => {
  const now = 1_000_000

  it('reloads the first time and again after the cooldown', () => {
    expect(decideRecovery(null, now)).toBe('reload')
    expect(
      decideRecovery({ at: now - RELOAD_COOLDOWN_MS, reason: 'x' }, now),
    ).toBe('reload')
  })

  it('gives up when the last reload was moments ago', () => {
    expect(decideRecovery({ at: now - 1000, reason: 'x' }, now)).toBe('give-up')
  })

  it('shows the restarted notice once, right after a reload', () => {
    expect(isRestartNoticeDue(null, now)).toBe(false)
    expect(isRestartNoticeDue({ at: now - 2000, reason: 'x' }, now)).toBe(true)
    expect(
      isRestartNoticeDue({ at: now - 2000, reason: 'x', noticed: true }, now),
    ).toBe(false)
    expect(
      isRestartNoticeDue({ at: now - RELOAD_COOLDOWN_MS, reason: 'x' }, now),
    ).toBe(false)
  })

  it('reads only well-formed records', () => {
    expect(parseRecoveryRecord(null)).toBeNull()
    expect(parseRecoveryRecord('not json')).toBeNull()
    expect(parseRecoveryRecord('{"at":"soon"}')).toBeNull()
    expect(parseRecoveryRecord('{"at":5,"reason":"r"}')).toEqual({
      at: 5,
      reason: 'r',
      noticed: undefined,
    })
  })
})

describe('createWatchdog', () => {
  /** A fake network: `routes` maps a path to the response it gets. */
  function setup(routes: Record<string, () => Response | Promise<Response>>) {
    let time = 0
    const calls: string[] = []
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(
        String(input instanceof Request ? input.url : input),
        BASE,
      )
      calls.push(url.pathname)
      const route = Object.entries(routes).find(([path]) =>
        url.pathname.endsWith(path),
      )
      if (!route) {
        throw new TypeError('Failed to fetch')
      }
      return route[1]()
    })
    const onBypassed = vi.fn()
    const watchdog = createWatchdog({
      fetch,
      baseUrl: BASE,
      now: () => time,
      onBypassed,
    })
    const pings = () => calls.filter((path) => path.endsWith(PING_PATH)).length
    return {
      watchdog,
      onBypassed,
      pings,
      advance: (ms: number) => {
        time += ms
      },
    }
  }

  it('restarts once when a backend request reached the dev server and the ping did too', async () => {
    const { watchdog, onBypassed, pings } = setup({
      'api/library/rev': () => json(503, { [UNHANDLED_HEADER]: '1' }),
      [PING_PATH]: () => html(),
    })
    const response = await watchdog.fetch('api/library/rev')
    expect(response.status).toBe(503)
    await vi.waitFor(() => expect(onBypassed).toHaveBeenCalledTimes(1))
    expect(onBypassed.mock.calls[0]?.[0]).toContain('/api/library/rev')

    await watchdog.fetch('api/library/rev')
    expect(await watchdog.check('again')).toBe('bypassed')
    expect(onBypassed).toHaveBeenCalledTimes(1)
    expect(pings()).toBe(1)
  })

  it("leaves the mock's own 5xx alone when the worker answers the ping", async () => {
    const { watchdog, onBypassed, pings, advance } = setup({
      'api/library/rev': () => json(502),
      [PING_PATH]: () => alive(),
    })
    await watchdog.fetch('api/library/rev')
    expect(await watchdog.check('wait for it')).toBe('alive')
    // A burst of errors reuses the recent ping.
    await watchdog.fetch('api/library/rev')
    await watchdog.fetch('api/library/rev')
    expect(await watchdog.check('burst')).toBe('alive')
    expect(pings()).toBe(1)
    advance(PING_REUSE_MS)
    expect(await watchdog.check('later')).toBe('alive')
    expect(pings()).toBe(2)
    expect(onBypassed).not.toHaveBeenCalled()
  })

  it('ignores healthy answers, other paths and other origins', async () => {
    const { watchdog, pings } = setup({
      'api/library/rev': () => json(200),
      'assets/app.js': () => html(),
      'photo.jpg': () => html(),
    })
    await watchdog.fetch('api/library/rev')
    await watchdog.fetch('assets/app.js')
    await watchdog.fetch('https://picsum.example/api/photo.jpg')
    expect(pings()).toBe(0)
  })

  it('pings after a failed backend request and still throws its error', async () => {
    const { watchdog, onBypassed, pings } = setup({
      [PING_PATH]: () => html(),
    })
    await expect(watchdog.fetch('session')).rejects.toThrow('Failed to fetch')
    await vi.waitFor(() => expect(onBypassed).toHaveBeenCalledTimes(1))
    expect(pings()).toBe(1)
  })

  it("doesn't restart when the ping itself fails", async () => {
    const { watchdog, onBypassed } = setup({
      'api/library/rev': () => json(503, { [UNHANDLED_HEADER]: '1' }),
    })
    await watchdog.fetch(new Request(new URL('api/library/rev', BASE)))
    expect(await watchdog.check('wait for it')).toBe('unknown')
    expect(onBypassed).not.toHaveBeenCalled()
  })
})
