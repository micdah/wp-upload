import { afterEach, describe, expect, it, vi } from 'vitest'
import { libraryApi } from './api'
import { LibraryError } from './errors'
import { libraryUrl, request, setHttpDeps } from './http'
import { createSessionGate } from './session'
import { type DataTestContext, startDataTest } from './test-utils'

let test: DataTestContext

afterEach(() => {
  test?.stop()
})

/** Lets pending promise callbacks run. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('libraryUrl', () => {
  it('is relative, joins lists with commas and drops empty values', () => {
    expect(libraryUrl('items', { ids: [3, 1, 2], view: null, q: '' })).toBe(
      'api/library/items?ids=3,1,2',
    )
    expect(libraryUrl('/posts', { search: 'a b&c', limit: 5 })).toBe(
      'api/library/posts?search=a%20b%26c&limit=5',
    )
    expect(libraryUrl('rev')).toBe('api/library/rev')
  })
})

describe('errors', () => {
  it('turns the ApiError envelope into a LibraryError with its code', async () => {
    test = startDataTest()
    const error = await libraryApi
      .collection({
        folder: 999999,
        q: null,
        type: null,
        alt: null,
        size: null,
        orient: null,
        month: null,
        sort: 'date-desc',
      })
      .catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(LibraryError)
    expect(error).toMatchObject({
      status: 404,
      code: 'wpu_folder_not_found',
      kind: 'action',
    })
  })

  it('reports WordPress being unreachable as connectivity, and a probe clears it', async () => {
    test = startDataTest()
    test.mock.network = 'offline'
    const error = await libraryApi.rev().catch((caught: unknown) => caught)
    expect(error).toMatchObject({
      code: 'wp_unreachable',
      kind: 'connectivity',
    })
    expect(test.connectivity.getSnapshot()).toMatchObject({
      state: 'offline',
      failures: 1,
    })
    await libraryApi.rev().catch(() => null)
    expect(test.connectivity.getSnapshot().failures).toBe(2)

    test.mock.network = 'online'
    // A plain read doesn't prove WordPress is back (it may come from cache)…
    await libraryApi.folders()
    expect(test.connectivity.getSnapshot().state).toBe('offline')
    // …a probe does.
    await libraryApi.rev()
    expect(test.connectivity.getSnapshot()).toMatchObject({
      state: 'online',
      failures: 0,
    })
  })

  it('counts bootstrap as a probe by its wp.state, not its 200 (C-13)', async () => {
    test = startDataTest()
    test.mock.network = 'offline'
    await libraryApi.rev().catch(() => null)
    expect(test.connectivity.getSnapshot().state).toBe('offline')

    // Bootstrap still answers 200, saying WordPress is unreachable.
    const down = await libraryApi.bootstrap()
    expect(down.wp.state).toBe('unreachable')
    expect(test.connectivity.getSnapshot()).toMatchObject({
      state: 'offline',
      failures: 2,
    })

    test.mock.network = 'online'
    const up = await libraryApi.bootstrap()
    expect(up.wp.state).toBe('ok')
    expect(test.connectivity.getSnapshot().state).toBe('online')
  })

  it('treats a failed fetch and a proxy error page as connectivity', async () => {
    const restore = setHttpDeps({
      gate: createSessionGate(),
      fetch: vi
        .fn()
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
        .mockResolvedValueOnce(
          new Response('<html>Bad gateway</html>', {
            status: 502,
            headers: { 'Content-Type': 'text/html' },
          }),
        ),
    })
    try {
      await expect(request('GET', 'rev')).rejects.toMatchObject({
        status: 0,
        code: 'network_error',
        kind: 'connectivity',
      })
      await expect(request('GET', 'rev')).rejects.toMatchObject({
        status: 502,
        code: 'invalid_response',
        kind: 'connectivity',
      })
    } finally {
      restore()
    }
  })

  it('classifies wp_auth_failed and plugin errors', async () => {
    test = startDataTest('wp-auth-failed')
    await expect(libraryApi.rev()).rejects.toMatchObject({ kind: 'wp-auth' })
    expect(test.connectivity.getSnapshot().state).toBe('wp-auth-failed')
    test.stop()
    test = startDataTest('plugin-outdated')
    await expect(libraryApi.rev()).rejects.toMatchObject({
      status: 409,
      code: 'plugin_incompatible',
      kind: 'plugin',
    })
  })
})

describe('401 pause and resume', () => {
  it('holds a request that got 401 until the session is restored, then replays it', async () => {
    test = startDataTest()
    test.mock.session.loggedIn = false
    let settled = false
    const pending = libraryApi.rev().then((value) => {
      settled = true
      return value
    })
    await flush()
    expect(test.gate.state).toBe('lost')
    expect(settled).toBe(false)

    // The user logs in again; the dialog restores the gate.
    test.mock.session.loggedIn = true
    test.gate.restore()
    const rev = await pending
    expect(rev.rev).toBe(test.mock.library.rev)
    expect(
      test.requests.filter((line) => line.endsWith('api/library/rev')),
    ).toHaveLength(2)
  })

  it('holds new requests while lost without sending them', async () => {
    test = startDataTest()
    test.gate.markLost()
    const pending = libraryApi.folders()
    await flush()
    expect(test.requests).toEqual([])
    test.gate.restore()
    await expect(pending).resolves.toMatchObject({ mode: { pro: false } })
    expect(test.requests).toEqual(['GET api/library/folders'])
  })

  it('replays a mutation after re-login (a 401 never reached the route)', async () => {
    test = startDataTest()
    const before = test.mock.library.item(1000)?.alt
    test.mock.session.loggedIn = false
    const pending = libraryApi.patchItem(1000, { alt: 'After re-login' })
    await flush()
    expect(test.mock.library.item(1000)?.alt).toBe(before)
    test.mock.session.loggedIn = true
    test.gate.restore()
    await expect(pending).resolves.toMatchObject({
      previous: { alt: before },
      item: { alt: 'After re-login' },
    })
  })

  it('fails waiting requests with session_lost when the user logs out', async () => {
    test = startDataTest()
    test.mock.session.loggedIn = false
    const pending = libraryApi.rev().catch((caught: unknown) => caught)
    await flush()
    test.gate.abandon()
    expect(await pending).toMatchObject({
      code: 'session_lost',
      kind: 'session',
    })
    expect(test.gate.state).toBe('active')
  })

  it('tells the app once per 401 of the current session', async () => {
    test = startDataTest()
    test.mock.session.loggedIn = false
    const pending = libraryApi.rev()
    await flush()
    expect(test.unauthorized.count).toBe(1)
    test.mock.session.loggedIn = true
    test.gate.restore()
    await pending
    expect(test.unauthorized.count).toBe(1)
  })

  it('retries a 401 sent before a re-login without marking the new session lost (C-1)', async () => {
    const gate = createSessionGate()
    const notify = vi.fn()
    let answerFirst: (response: Response) => void = () => {}
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            answerFirst = resolve
          }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ rev: '7' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    const restore = setHttpDeps({
      gate,
      fetch: fetchMock,
      notifyUnauthorized: notify,
    })
    try {
      const pending = request<{ rev: string }>('GET', 'rev')
      await flush()
      // Another request lost the session meanwhile; the user logged in again.
      gate.markLost()
      gate.restore()
      // Only now does the old request's 401 arrive.
      answerFirst(new Response(null, { status: 401 }))
      const response = await pending
      expect(response.data).toEqual({ rev: '7' })
      expect(gate.state).toBe('active')
      expect(notify).not.toHaveBeenCalled()
      expect(fetchMock).toHaveBeenCalledTimes(2)
    } finally {
      restore()
    }
  })

  it('lets an abort end a request that waits for the session', async () => {
    test = startDataTest()
    test.gate.markLost()
    const controller = new AbortController()
    const pending = libraryApi
      .rev({ signal: controller.signal })
      .catch((caught: unknown) => caught)
    controller.abort()
    expect(await pending).toMatchObject({ name: 'AbortError' })
    expect(test.requests).toEqual([])
  })
})
