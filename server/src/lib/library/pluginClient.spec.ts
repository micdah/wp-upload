import type { AxiosRequestConfig } from 'axios'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { pluginInfo } from '../../../../shared/fixtures/index.ts'
import { wpAxios } from '../../config/wpClient.ts'
import { LibraryError } from './errors.ts'
import {
  pluginClient,
  postTypes,
  resetPluginClientForTests,
  sendUntilDone,
  setRevObserver,
  TIMEOUTS,
} from './pluginClient.ts'
import {
  httpError,
  okResponse,
  recordedCall,
  wpErrorResponse,
} from './specSupport.ts'

function spyRequest() {
  return vi.spyOn(wpAxios, 'request')
}

function lastCall(spy: ReturnType<typeof spyRequest>, index = 0) {
  const config = spy.mock.calls[index]?.[0] as AxiosRequestConfig
  return { config, call: recordedCall(config) }
}

afterEach(() => {
  setRevObserver(null)
  resetPluginClientForTests()
})

describe('pluginClient', () => {
  it('calls the plugin namespace with the read timeout and no redirects', async () => {
    const spy = spyRequest().mockResolvedValue(okResponse(pluginInfo))

    await expect(pluginClient.info()).resolves.toEqual(pluginInfo)

    const { config, call } = lastCall(spy)
    expect(call.method).toBe('GET')
    expect(call.url).toBe('/wp-json/wp-upload/v1/info')
    expect(config.timeout).toBe(TIMEOUTS.read)
    expect(config.maxRedirects).toBe(0)
    expect(config.signal).toBeInstanceOf(AbortSignal)
  })

  it('uses the 10 s timeout for /rev and lets callers override timeouts', async () => {
    const spy = spyRequest().mockResolvedValue(
      okResponse({ rev: '1', index: pluginInfo.index }),
    )
    await pluginClient.rev()
    await pluginClient.info({ timeoutMs: TIMEOUTS.bootstrap })
    expect(lastCall(spy, 0).config.timeout).toBe(10_000)
    expect(lastCall(spy, 1).config.timeout).toBe(10_000)
  })

  it('sends collection params and comma-joined usage ids', async () => {
    const spy = spyRequest().mockResolvedValue(okResponse({ rev: '1' }))
    await pluginClient.collection({ folder: '0', q: 'beach' })
    await pluginClient.usage([3, 1, 2])
    expect(lastCall(spy, 0).call.params).toEqual({ folder: '0', q: 'beach' })
    expect(lastCall(spy, 1).call.params).toEqual({ ids: '3,1,2' })
  })

  it('posts JSON mutations with the mutation timeout', async () => {
    const spy = spyRequest().mockResolvedValue(
      okResponse({ rev: '2', results: [], remaining: [] }),
    )
    const body = { items: [{ id: 1, set: { alt: 'x' } }] }
    await pluginClient.mediaBatch(body)
    const { config, call } = lastCall(spy)
    expect(call.method).toBe('POST')
    expect(call.url).toBe('/wp-json/wp-upload/v1/media/batch')
    expect(call.data).toEqual(body)
    expect(call.headers['Content-Type']).toBe('application/json')
    expect(config.timeout).toBe(TIMEOUTS.mutation)
  })

  it('gives image operations only the long idle timeout', async () => {
    const spy = spyRequest().mockResolvedValue(okResponse({ rev: '3' }))
    await pluginClient.imageRegenerate(1009)
    const { config, call } = lastCall(spy)
    expect(call.url).toBe('/wp-json/wp-upload/v1/media/1009/regenerate')
    expect(config.timeout).toBe(TIMEOUTS.long)
    expect(config.signal).toBeUndefined()
  })

  it('retries PATCH and DELETE once as POST with X-HTTP-Method-Override on a 405', async () => {
    const spy = spyRequest()
      .mockRejectedValueOnce(httpError(405, '<html>Not allowed</html>'))
      .mockResolvedValueOnce(okResponse({ rev: '4' }))

    await pluginClient.updateFolder(3, { name: 'Logos' })

    expect(spy).toHaveBeenCalledTimes(2)
    expect(lastCall(spy, 0).call.method).toBe('PATCH')
    const retry = lastCall(spy, 1).call
    expect(retry.method).toBe('POST')
    expect(retry.url).toBe('/wp-json/wp-upload/v1/folders/3')
    expect(retry.headers['X-HTTP-Method-Override']).toBe('PATCH')
    expect(retry.data).toEqual({ name: 'Logos' })
  })

  it('does not retry other errors', async () => {
    const spy = spyRequest().mockRejectedValue(
      wpErrorResponse(409, 'wpu_folder_cycle'),
    )
    await expect(pluginClient.deleteFolder(3)).rejects.toThrow()
    expect(spy).toHaveBeenCalledOnce()
  })

  it('rejects a 2xx that is not JSON', async () => {
    spyRequest().mockResolvedValue(okResponse('<html>Maintenance</html>'))
    const err = await pluginClient.folders().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(LibraryError)
    expect((err as LibraryError).code).toBe('wp_unexpected_response')
  })

  it('reports every rev it sees, /rev as a poll', async () => {
    const seen: Array<[string, string]> = []
    setRevObserver((rev, source) => seen.push([rev, source]))
    spyRequest()
      .mockResolvedValueOnce(okResponse({ rev: '10', index: pluginInfo.index }))
      .mockResolvedValueOnce(okResponse({ rev: '11', results: [] }))
      .mockResolvedValueOnce(okResponse({ rev: 'not-a-rev' }))
    await pluginClient.rev()
    await pluginClient.mediaTrash({ ids: [1] })
    await pluginClient.trash()
    expect(seen).toEqual([
      ['10', 'poll'],
      ['11', 'response'],
    ])
  })
})

describe('sendUntilDone', () => {
  it('re-sends remaining ids and returns results in request order', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({
        rev: '5',
        results: [{ id: 3, ok: true }],
        remaining: [1, 2],
      })
      .mockResolvedValueOnce({
        rev: '6',
        results: [
          { id: 1, ok: true },
          { id: 2, ok: true },
        ],
        remaining: [],
      })

    const answer = await sendUntilDone([3, 1, 2], (id) => id, send)

    expect(send).toHaveBeenNthCalledWith(1, [3, 1, 2])
    expect(send).toHaveBeenNthCalledWith(2, [1, 2])
    expect(answer).toEqual({
      rev: '6',
      results: [
        { id: 3, ok: true },
        { id: 1, ok: true },
        { id: 2, ok: true },
      ],
    })
  })

  it('gives up after three rounds in a row without progress', async () => {
    const send = vi
      .fn()
      .mockResolvedValue({ rev: '5', results: [], remaining: [1] })
    await expect(sendUntilDone([1], (id) => id, send)).rejects.toBeInstanceOf(
      LibraryError,
    )
    expect(send).toHaveBeenCalledTimes(3)
  })
})

describe('postTypes', () => {
  it('merges singular labels from context=edit with context=view', async () => {
    const spy = spyRequest().mockImplementation(async (config) => {
      const context = (config.params as { context: string }).context
      if (context === 'edit') {
        return okResponse({
          post: { slug: 'post', labels: { singular_name: 'Post' } },
        })
      }
      return okResponse({
        post: { slug: 'post', name: 'Posts', rest_base: 'posts' },
        page: { slug: 'page', name: 'Pages', rest_base: 'pages' },
        wp_block: { slug: 'wp_block', rest_base: 'blocks' },
      })
    })

    const types = await postTypes()
    await postTypes()

    expect(spy).toHaveBeenCalledTimes(2)
    expect(types.get('post')?.label).toBe('Post')
    expect(types.get('page')?.label).toBe('Pages')
    expect(types.get('wp_block')).toEqual({
      slug: 'wp_block',
      label: 'Wp block',
      restBase: 'blocks',
      restNamespace: 'wp/v2',
    })
  })

  it('copes with a user who can edit no type', async () => {
    spyRequest().mockImplementation(async (config) => {
      const context = (config.params as { context: string }).context
      if (context === 'edit') throw wpErrorResponse(403, 'rest_cannot_view')
      return okResponse({ page: { slug: 'page', name: 'Pages' } })
    })
    const types = await postTypes()
    expect(types.get('page')?.label).toBe('Pages')
  })
})
