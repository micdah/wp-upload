// The mock's service worker script (serviceWorker.js), run in a bare
// service-worker-like scope: it loads MSW's worker after its own fetch
// listener, which hides navigations and other origins from MSW.

import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

const SCRIPT = readFileSync(
  new URL('./serviceWorker.js', import.meta.url),
  'utf8',
)
const SCOPE = 'https://example.com/wp-upload-mock/'

type Listener = (event: unknown) => void

function loadWorker() {
  const listeners: { type: string; listener: Listener }[] = []
  const imported: string[] = []
  const scope = {
    registration: { scope: SCOPE },
    addEventListener: (type: string, listener: Listener) => {
      listeners.push({ type, listener })
    },
  }
  runInNewContext(SCRIPT, {
    self: scope,
    URL,
    importScripts: (...urls: string[]) => {
      // MSW's listeners come after the mock's own.
      expect(listeners).toHaveLength(1)
      imported.push(...urls)
    },
  })
  const fetchListener = listeners.find(({ type }) => type === 'fetch')
  if (!fetchListener) {
    throw new Error('no fetch listener')
  }
  /** Whether MSW's fetch listener would see this request. */
  const reachesMsw = (url: string, mode: RequestMode = 'cors') => {
    let stopped = false
    fetchListener.listener({
      request: { url: new URL(url, SCOPE).href, mode },
      stopImmediatePropagation: () => {
        stopped = true
      },
    })
    return !stopped
  }
  return { imported, reachesMsw }
}

describe('the mock service worker', () => {
  it("imports MSW's worker from next to itself", () => {
    expect(loadWorker().imported).toEqual(['./mockServiceWorker.js'])
  })

  it('lets MSW see same-origin requests', () => {
    const { reachesMsw } = loadWorker()
    expect(reachesMsw('api/library/rev')).toBe(true)
    expect(reachesMsw('session')).toBe(true)
    expect(reachesMsw('mock-media/1/300x200/a.jpg', 'no-cors')).toBe(true)
    expect(reachesMsw('assets/index.js', 'same-origin')).toBe(true)
  })

  it('keeps page navigations away from MSW, except to api/ (downloads)', () => {
    const { reachesMsw } = loadWorker()
    expect(reachesMsw('./?view=library', 'navigate')).toBe(false)
    expect(reachesMsw('', 'navigate')).toBe(false)
    expect(reachesMsw('https://example.com/elsewhere', 'navigate')).toBe(false)
    expect(reachesMsw('api/library/items/7/download', 'navigate')).toBe(true)
  })

  it('keeps other origins away from MSW', () => {
    const { reachesMsw } = loadWorker()
    expect(reachesMsw('https://picsum.photos/id/1/300/200', 'no-cors')).toBe(
      false,
    )
    expect(reachesMsw('https://fonts.example/api/font.woff2')).toBe(false)
  })
})
