// An in-memory history for tests: a list of entries, a cursor, and popstate
// delivered on `flush()` (browsers deliver it asynchronously after back()).

import type { UrlEnvironment } from './history'

interface Entry {
  url: URL
  state: unknown
}

export interface MemoryHistory extends UrlEnvironment {
  /** Delivers pending popstate events, as the browser would after back(). */
  flush(): void
  /** Simulates the user pressing the browser's Back (or Forward) button. */
  go(delta: number): void
  /** Every entry's search string, and the cursor. */
  entries(): { searches: string[]; index: number }
}

export function createMemoryHistory(
  initialUrl = 'https://example.com/wp-upload/',
): MemoryHistory {
  const entries: Entry[] = [{ url: new URL(initialUrl), state: null }]
  let index = 0
  let pendingPops = 0
  const popListeners = new Set<() => void>()

  function current(): Entry {
    const entry = entries[index]
    if (!entry) {
      throw new Error('memory history: no current entry')
    }
    return entry
  }

  function resolve(url: string): URL {
    return new URL(url, current().url)
  }

  function move(delta: number): void {
    const target = index + delta
    if (target < 0 || target >= entries.length) {
      return
    }
    index = target
    pendingPops += 1
  }

  return {
    history: {
      get state() {
        return current().state
      },
      pushState(data, _unused, url) {
        entries.splice(index + 1)
        entries.push({ url: resolve(url), state: structuredClone(data) })
        index = entries.length - 1
      },
      replaceState(data, _unused, url) {
        entries[index] = { url: resolve(url), state: structuredClone(data) }
      },
      back() {
        move(-1)
      },
    },
    location: {
      get pathname() {
        return current().url.pathname
      },
      get search() {
        return current().url.search
      },
      get hash() {
        return current().url.hash
      },
    },
    onPopState(listener) {
      popListeners.add(listener)
      return () => popListeners.delete(listener)
    },
    flush() {
      while (pendingPops > 0) {
        pendingPops -= 1
        for (const listener of popListeners) {
          listener()
        }
      }
    },
    go(delta) {
      move(delta)
    },
    entries() {
      return { searches: entries.map((entry) => entry.url.search), index }
    },
  }
}
