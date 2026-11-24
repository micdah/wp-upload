import { afterEach, describe, expect, it, vi } from 'vitest'
import * as wpClient from '../../config/wpClient.ts'
import { wpAxios } from '../../config/wpClient.ts'
import { resetCacheForTests } from './cache.ts'
import { toLibraryError } from './errors.ts'
import {
  fetchMedia,
  MEDIA_FIELDS,
  parentLink,
  resolveParents,
} from './normalise/items.ts'
import { postTypes, resetPluginClientForTests, wpGet } from './pluginClient.ts'

// What the server relies on from WordPress core itself, checked against the
// live stack (dev/run test server-live). Needs no companion plugin routes, so
// it runs before track P1 lands. Spike X5's timing is the last test.

const live = process.env.WPU_LIVE === '1'

async function firstIds(count: number): Promise<number[]> {
  const media = await wpGet<Array<{ id: number }>>('/wp/v2/media', {
    per_page: count,
    orderby: 'id',
    order: 'desc',
    _fields: 'id',
  })
  return media.map((entry) => entry.id)
}

afterEach(() => {
  resetCacheForTests()
  resetPluginClientForTests()
})

describe.skipIf(!live)('WordPress core, live', () => {
  it('hydrates 100 ids with include=, in any status, with only the asked fields', async () => {
    const ids = await firstIds(100)
    expect(ids.length).toBeGreaterThanOrEqual(100)
    const shuffled = [...ids].reverse()

    const media = await fetchMedia(shuffled, 'tile')

    expect(media.map((entry) => entry.id).sort()).toEqual([...ids].sort())
    const allowed = new Set(MEDIA_FIELDS.tile.map((f) => f.split('.')[0]))
    for (const entry of media) {
      for (const key of Object.keys(entry)) expect(allowed).toContain(key)
      // WordPress 7.0+ reports the original upload's name.
      expect(typeof entry.filename).toBe('string')
      expect(entry.date_gmt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$/)
    }
  })

  it('links attached items to their parent and resolves it to a PostRef', async () => {
    const all = await wpGet<Array<{ id: number; post: number }>>(
      '/wp/v2/media',
      { per_page: 100, _fields: 'id,post' },
    )
    const attached = all.filter((entry) => entry.post > 0).slice(0, 5)
    expect(attached.length).toBeGreaterThan(0)

    const media = await fetchMedia(
      attached.map((entry) => entry.id),
      'full',
    )
    const links = media.map(parentLink).filter((link) => link !== null)
    expect(links).toHaveLength(attached.length)
    for (const link of links) {
      expect(link.href).toMatch(/\/wp-json\/wp\/v2\/[a-z_-]+\/\d+$/)
      expect(link.postType).toBeTruthy()
    }

    const refs = await resolveParents(links)
    for (const link of links) {
      const ref = refs.get(link.postId)
      expect(ref).toBeTruthy()
      expect(ref?.postId).toBe(link.postId)
      expect(ref?.postTypeLabel).not.toBe('')
      // The seeded app user is an Editor: every post is editable.
      expect(ref?.editUrl).toBe(
        `${process.env.WP_URL}/wp-admin/post.php?post=${link.postId}&action=edit`,
      )
      if (ref?.status !== 'publish') expect(ref?.viewUrl).toBeNull()
    }
  })

  it('reads singular post type labels', async () => {
    const types = await postTypes()
    expect(types.get('post')?.label).toBe('Post')
    expect(types.get('page')?.label).toBe('Page')
  })

  it('maps a rejected Application Password to wp_auth_failed', async () => {
    vi.spyOn(wpClient, 'invalidateConnection').mockImplementation(() => {})
    const err = await wpAxios
      .request({
        url: '/wp-json/wp/v2/users/me',
        headers: {
          Authorization: `Basic ${Buffer.from('nobody:wrong').toString('base64')}`,
        },
      })
      .catch((e: unknown) => e)
    expect(toLibraryError(err)).toMatchObject({
      status: 502,
      body: { code: 'wp_auth_failed', details: { upstreamStatus: 401 } },
    })
  })

  it('maps an unknown plugin route to plugin_missing', async () => {
    const err = await wpGet('/wp-upload/v1/no-such-route', {}).catch(
      (e: unknown) => e,
    )
    expect(toLibraryError(err)).toMatchObject({
      status: 409,
      body: { code: 'plugin_missing' },
    })
  })

  it('maps rest_invalid_param to invalid_request with the params', async () => {
    const err = await wpGet('/wp/v2/media', { per_page: 1000 }).catch(
      (e: unknown) => e,
    )
    const mapped = toLibraryError(err)
    expect(mapped.status).toBe(400)
    expect(mapped.body.code).toBe('invalid_request')
    expect(mapped.body.details).toMatchObject({
      upstreamCode: 'rest_invalid_param',
      params: { per_page: expect.any(String) },
    })
  })

  // Spike X5: over 500 ms for 100 tiles would call for a plugin `tiles` route.
  it('hydrates 100 tiles well within 500 ms (spike X5)', async () => {
    const ids = (await firstIds(100)).reverse()
    await fetchMedia(ids, 'tile')
    const times: number[] = []
    for (let run = 0; run < 10; run++) {
      const started = performance.now()
      await fetchMedia(ids, 'tile')
      times.push(performance.now() - started)
    }
    times.sort((a, b) => a - b)
    const median = times[Math.floor(times.length / 2)] ?? 0
    console.log(
      `X5: include= of 100 tiles, median ${median.toFixed(0)} ms, max ${times.at(-1)?.toFixed(0)} ms`,
    )
    expect(median).toBeLessThan(500)
  })
})
