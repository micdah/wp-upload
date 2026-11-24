import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  fullItems,
  siteInfo,
  tileItems,
  trashItems,
} from '../../../../../shared/fixtures/index.ts'
import {
  LibraryItemFullSchema,
  LibraryItemTileSchema,
} from '../../../../../shared/library-api.schema.ts'
import type { LibraryItemFull } from '../../../../../shared/library-api.ts'
import { env } from '../../../config/env.ts'
import { resetCacheForTests } from '../cache.ts'
import { resetPluginClientForTests } from '../pluginClient.ts'
import {
  callsTo,
  fakeWordPress,
  wpErrorResponse,
  wpMediaFor,
} from '../specSupport.ts'
import {
  decodeHtml,
  formatShutter,
  hydrateItems,
  MEDIA_FIELDS,
  type NormaliseContext,
  normaliseFull,
  normaliseTile,
  parentRoute,
  restRouteOf,
  type WpMedia,
  type WpMediaSize,
} from './items.ts'

// "Now" of the fixtures: both trashed items' daysLeft hold at this time.
const NOW = Date.parse('2026-11-22T12:00:00Z')
const context: NormaliseContext = {
  trashDays: 30,
  now: NOW,
  wpUrl: 'https://example.com',
  sizeOrder: siteInfo.imageSizes.map((size) => size.name),
  attachmentPages: false,
}

const originalWpUrl = env.wpUrl
beforeEach(() => {
  env.wpUrl = 'https://example.com'
})
afterEach(() => {
  env.wpUrl = originalWpUrl
  resetCacheForTests()
  resetPluginClientForTests()
})

function byId<T extends { id: number }>(items: readonly T[], id: number): T {
  const item = items.find((entry) => entry.id === id)
  if (!item) throw new Error(`no fixture ${id}`)
  return item
}

/**
 * A srcset never lists one file twice (item 1004's fixture does: its
 * medium_large and large sizes are the same file).
 */
function uniqueSrcset<T extends { srcset: { url: string }[] }>(item: T): T {
  const seen = new Set<string>()
  return {
    ...item,
    srcset: item.srcset.filter((source) => {
      if (seen.has(source.url)) return false
      seen.add(source.url)
      return true
    }),
  }
}

/**
 * The only place real WordPress can't give what the fixture says: REST
 * overwrites a PDF's `sizes.full` (the preview image) without a file size.
 */
function expectedFull(item: LibraryItemFull): LibraryItemFull {
  const unique = uniqueSrcset(item)
  if (item.mime !== 'application/pdf') return unique
  return {
    ...unique,
    sizes: item.sizes.map((size) =>
      size.name === 'full' ? { ...size, filesize: null } : size,
    ),
  }
}

describe('normaliseTile and normaliseFull', () => {
  it.each(fullItems.map((item) => [item.id, item] as const))(
    'item %i: WordPress + wpu → the fixture DTOs',
    (id, full) => {
      const media = wpMediaFor(full)
      const tile = normaliseTile(media, context)
      const expectedTile = byId(
        [...tileItems, ...trashItems] as unknown as LibraryItemFull[],
        id,
      )
      expect(tile).toEqual(uniqueSrcset(expectedTile))
      expect(LibraryItemTileSchema.parse(tile)).toEqual(tile)

      const normalised = normaliseFull(media, context, full.attachedTo)
      expect(normalised).toEqual(expectedFull(full))
      expect(LibraryItemFullSchema.parse(normalised)).toEqual(normalised)
    },
  )

  it('builds `full` for an image WordPress made no sizes for', () => {
    const svgLike = byId(fullItems, 1000)
    const media: WpMedia = {
      ...wpMediaFor(svgLike),
      media_details: { sizes: {} },
    }
    const tile = normaliseTile(media, context)
    expect(tile.thumb).toBeNull()
    expect(tile.srcset).toEqual([
      { url: svgLike.url, width: svgLike.width, height: svgLike.height },
    ])
  })

  it('copes with media_details as an empty array (PHP empty array)', () => {
    const audio = byId(fullItems, 1090)
    const media: WpMedia = { ...wpMediaFor(audio), media_details: [] }
    const full = normaliseFull(media, context, null)
    expect(full.sizes).toEqual([])
    expect(full.media).toBeNull()
  })

  it('reports daysLeft null when WordPress never purges the Trash', () => {
    const trashed = byId(fullItems, 1017)
    const tile = normaliseTile(wpMediaFor(trashed), {
      ...context,
      trashDays: 0,
    })
    expect(tile.trash).toEqual({
      trashedAt: trashed.trash?.trashedAt,
      daysLeft: null,
    })
  })

  it('never reports negative daysLeft', () => {
    const trashed = byId(fullItems, 1017)
    const tile = normaliseTile(wpMediaFor(trashed), {
      ...context,
      now: NOW + 365 * 86_400_000,
    })
    expect(tile.trash?.daysLeft).toBe(0)
  })

  it('falls back to the original file name without the filename field', () => {
    const scaled = byId(fullItems, 1009)
    const { filename: _filename, ...media } = wpMediaFor(scaled)
    expect(normaliseTile(media, context).filename).toBe(
      'travel-fre-sonneveld-314.jpg',
    )
  })

  it('links the attachment page only when the site has them', () => {
    const item = byId(fullItems, 1009)
    const media = {
      ...wpMediaFor(item),
      link: 'https://example.com/?attachment_id=1009',
    }
    expect(normaliseFull(media, context, null).links.view).toBeNull()
    expect(
      normaliseFull(media, { ...context, attachmentPages: true }, null).links
        .view,
    ).toBe('https://example.com/?attachment_id=1009')
  })

  it('lists sizes in registered order, whatever order WordPress stored', () => {
    const item = byId(fullItems, 1013)
    const media = wpMediaFor(item)
    const details = media.media_details as {
      sizes: Record<string, WpMediaSize>
    }
    // WordPress generates (and stores) medium, large, thumbnail, … first.
    const { medium, large, thumbnail, ...rest } = details.sizes
    const stored = {
      medium,
      large,
      thumbnail,
      ...rest,
      custom: {
        file: 'x-40x60.jpg',
        width: 40,
        height: 60,
        mime_type: 'image/jpeg',
        source_url: 'https://example.com/x-40x60.jpg',
      },
    }
    const full = normaliseFull(
      {
        ...media,
        media_details: {
          ...details,
          sizes: stored as Record<string, WpMediaSize>,
        },
      },
      context,
      null,
    )
    expect(full.sizes.map((size) => size.name)).toEqual([
      ...item.sizes.map((size) => size.name).filter((name) => name !== 'full'),
      'custom',
      'full',
    ])
  })

  it('fails clearly without the wpu field', () => {
    const media = { ...wpMediaFor(byId(fullItems, 1000)), wpu: undefined }
    expect(() => normaliseTile(media, context)).toThrow(/wpu field/)
  })

  it('maps an unknown kind to other', () => {
    const item = byId(fullItems, 1092)
    const media = wpMediaFor(item)
    const wpu = media.wpu
    if (!wpu) throw new Error('fixture without wpu')
    const tile = normaliseTile(
      { ...media, wpu: { ...wpu, kind: 'hologram' as never } },
      context,
    )
    expect(tile.kind).toBe('other')
  })
})

describe('formatting helpers', () => {
  it.each([
    [1 / 60, '1/60'],
    [0.001, '1/1000'],
    [2, '2s'],
    [1.5, '1.5s'],
  ])('formatShutter(%f) = %s', (seconds, text) => {
    expect(formatShutter(seconds)).toBe(text)
  })

  it('decodes the entities WordPress renders', () => {
    expect(
      decodeHtml('Tom &amp; Jerry&#8217;s &#x201C;show&#x201D; &hellip;'),
    ).toBe('Tom & Jerry’s “show” …')
    expect(decodeHtml('&unknown; &#0;')).toBe('&unknown; &#0;')
  })
})

describe('hydrateItems', () => {
  const types = {
    post: { slug: 'post', name: 'Posts', rest_base: 'posts' },
    page: { slug: 'page', name: 'Pages', rest_base: 'pages' },
  }
  const editTypes = {
    post: { slug: 'post', labels: { singular_name: 'Post' } },
    page: { slug: 'page', labels: { singular_name: 'Page' } },
  }

  function mediaRoute(items: LibraryItemFull[]) {
    return (call: { params: Record<string, unknown> }) => {
      const ids = String(call.params.include).split(',').map(Number)
      return items
        .filter((item) => ids.includes(item.id))
        .map((item) => wpMediaFor(item))
    }
  }

  it('asks WordPress for the view context, every status and only the needed fields', async () => {
    const spy = fakeWordPress({
      'GET /wp-json/wp/v2/media': mediaRoute([...fullItems]),
    })

    const result = await hydrateItems([1001, 999999, 1000], 'tile')

    expect(result.items.map((item) => item.id)).toEqual([1001, 1000])
    expect(result.missing).toEqual([999999])
    const [call] = callsTo(spy, 'GET /wp-json/wp/v2/media')
    expect(call?.params).toEqual({
      include: '1001,999999,1000',
      per_page: 3,
      orderby: 'include',
      status: 'inherit,private,trash',
      context: 'view',
      _fields: MEDIA_FIELDS.tile.join(','),
    })
  })

  it('resolves attached-to posts once each, editable or not', async () => {
    const attached = fullItems.filter((item) => item.attachedTo)
    const spy = fakeWordPress({
      'GET /wp-json/wp/v2/media': mediaRoute([...fullItems]),
      'GET /wp-json/wp/v2/types': (call) =>
        call.params.context === 'edit' ? editTypes : types,
      'GET /wp-json/wp/v2/pages/203': () => ({
        id: 203,
        type: 'page',
        status: 'publish',
        link: 'https://example.com/?p=203',
        title: { rendered: 'About &amp; us' },
        _links: { self: [{ href: 'x', targetHints: { allow: ['GET'] } }] },
      }),
      'GET /wp-json/wp/v2/posts/201': () => ({
        id: 201,
        type: 'post',
        status: 'publish',
        link: 'https://example.com/?p=201',
        title: { rendered: 'Spring newsletter' },
        _links: {
          self: [
            {
              href: 'x',
              targetHints: { allow: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] },
            },
          ],
        },
      }),
      'GET /wp-json/wp/v2/posts/202': () => {
        throw wpErrorResponse(404, 'rest_post_invalid_id')
      },
    })

    const ids = attached.map((item) => item.id)
    const result = await hydrateItems(ids, 'full')

    const refs = new Map(
      result.items.map((item) => [item.id, item.attachedTo] as const),
    )
    const item1009 = refs.get(1009)
    expect(item1009).toEqual({
      postId: 203,
      postType: 'page',
      postTypeLabel: 'Page',
      title: 'About & us',
      status: 'publish',
      editUrl: null,
      viewUrl: 'https://example.com/?p=203',
    })
    expect(refs.get(1029)).toEqual(byId(fullItems, 1029).attachedTo)
    // A parent that no longer exists.
    const on202 = attached.find((item) => item.attachedTo?.postId === 202)
    if (on202) expect(refs.get(on202.id)).toBeNull()

    const parentCalls = callsTo(spy, 'GET /wp-json/wp/v2/posts/201')
    expect(parentCalls).toHaveLength(1)
    expect(parentCalls[0]?.params).toEqual({
      context: 'view',
      _fields: 'id,type,status,link,title,_links',
    })
  })

  it('probes context=edit when WordPress sends no targetHints', async () => {
    const item = byId(fullItems, 1009)
    const spy = fakeWordPress({
      'GET /wp-json/wp/v2/media': () => [wpMediaFor(item)],
      'GET /wp-json/wp/v2/types': () => types,
      'GET /wp-json/wp/v2/pages/203': (call) => {
        if (call.params.context === 'edit') {
          throw wpErrorResponse(403, 'rest_forbidden_context')
        }
        return {
          id: 203,
          type: 'page',
          status: 'draft',
          title: { rendered: '' },
        }
      },
    })
    const [full] = (await hydrateItems([1009], 'full')).items
    expect(full?.attachedTo).toMatchObject({
      title: '(no title)',
      status: 'draft',
      editUrl: null,
      viewUrl: null,
    })
    expect(callsTo(spy, 'GET /wp-json/wp/v2/pages/203')).toHaveLength(2)
  })

  it('shows a post the user cannot read as "Private post"', async () => {
    const item = byId(fullItems, 1009)
    fakeWordPress({
      'GET /wp-json/wp/v2/media': () => [wpMediaFor(item)],
      'GET /wp-json/wp/v2/types': () => types,
      'GET /wp-json/wp/v2/pages/203': () => {
        throw wpErrorResponse(403, 'rest_forbidden')
      },
    })
    const [full] = (await hydrateItems([1009], 'full')).items
    expect(full?.attachedTo).toEqual({
      postId: 203,
      postType: 'page',
      postTypeLabel: 'Pages',
      title: 'Private post',
      status: 'private',
      editUrl: null,
      viewUrl: null,
    })
  })

  /** Item 1009 (attached to page 203), linked to its parent through `href`. */
  function attachedVia(href: string, postType = 'page'): WpMedia {
    return {
      ...wpMediaFor(byId(fullItems, 1009)),
      _links: {
        'wp:attached-to': [{ embeddable: true, post_type: postType, href }],
      },
    }
  }

  const page203 = () => ({
    id: 203,
    type: 'page',
    status: 'publish',
    link: 'https://example.com/blog/about/',
    title: { raw: 'About us' },
    _links: { self: [{ href: 'x', targetHints: { allow: ['GET', 'PUT'] } }] },
  })

  it('reads the parent below a WP_URL in a subdirectory, without doubling it', async () => {
    env.wpUrl = 'https://example.com/blog'
    const spy = fakeWordPress({
      'GET /wp-json/wp/v2/media': () => [
        attachedVia('https://example.com/blog/wp-json/wp/v2/pages/203'),
      ],
      'GET /wp-json/wp/v2/types': () => types,
      'GET /wp-json/wp/v2/pages/203': page203,
    })
    const [full] = (await hydrateItems([1009], 'full')).items
    expect(full?.attachedTo).toMatchObject({
      postId: 203,
      title: 'About us',
      editUrl:
        'https://example.com/blog/wp-admin/post.php?post=203&action=edit',
    })
    // The path is relative to WP_URL (axios' baseURL), which holds /blog.
    expect(callsTo(spy, 'GET /wp-json/wp/v2/pages/203')).toHaveLength(1)
  })

  it('reads the parent when WordPress links to another origin than WP_URL', async () => {
    // e.g. an internal host name, while WordPress's siteurl is public.
    env.wpUrl = 'http://wordpress:8080'
    const spy = fakeWordPress({
      'GET /wp-json/wp/v2/media': () => [
        attachedVia('https://www.example.com/wp-json/wp/v2/pages/203'),
      ],
      'GET /wp-json/wp/v2/types': () => types,
      'GET /wp-json/wp/v2/pages/203': page203,
    })
    const [full] = (await hydrateItems([1009], 'full')).items
    expect(full?.attachedTo).toMatchObject({ postId: 203, title: 'About us' })
    expect(callsTo(spy, 'GET /wp-json/wp/v2/pages/203')).toHaveLength(1)
  })

  it('reads the parent through its post type’s REST base and namespace', async () => {
    env.wpUrl = 'https://example.com/blog'
    const spy = fakeWordPress({
      'GET /wp-json/wp/v2/media': () => [
        attachedVia('https://elsewhere.example/blog/wp-json/x/203', 'book'),
      ],
      'GET /wp-json/wp/v2/types': () => ({
        ...types,
        book: {
          slug: 'book',
          name: 'Books',
          rest_base: 'library-books',
          rest_namespace: 'shelf/v1',
        },
      }),
      'GET /wp-json/shelf/v1/library-books/203': () => ({
        ...page203(),
        type: 'book',
      }),
    })
    const [full] = (await hydrateItems([1009], 'full')).items
    expect(full?.attachedTo).toMatchObject({ postId: 203, postType: 'book' })
    expect(
      callsTo(spy, 'GET /wp-json/shelf/v1/library-books/203'),
    ).toHaveLength(1)
  })

  it('falls back to the posts route below WP_URL without a wp:attached-to link', async () => {
    env.wpUrl = 'https://example.com/blog'
    const spy = fakeWordPress({
      'GET /wp-json/wp/v2/media': () => [
        { ...wpMediaFor(byId(fullItems, 1009)), _links: {} },
      ],
      'GET /wp-json/wp/v2/types': () => types,
      'GET /wp-json/wp/v2/posts/203': () => ({ ...page203(), type: 'post' }),
    })
    const [full] = (await hydrateItems([1009], 'full')).items
    expect(full?.attachedTo).toMatchObject({ postId: 203, postType: 'post' })
    expect(callsTo(spy, 'GET /wp-json/wp/v2/posts/203')).toHaveLength(1)
  })

  it('fails on a media answer that is not a list', async () => {
    fakeWordPress({ 'GET /wp-json/wp/v2/media': () => ({ oops: true }) })
    await expect(hydrateItems([1], 'tile')).rejects.toMatchObject({
      code: 'wp_unexpected_response',
    })
  })
})

describe('parentRoute', () => {
  const known = new Map([
    [
      'page',
      {
        slug: 'page',
        label: 'Page',
        restBase: 'pages',
        restNamespace: 'wp/v2',
      },
    ],
  ])

  it.each([
    // Known type: its REST base, whatever the link says.
    [
      'https://www.example.com/blog/wp-json/wp/v2/pages/7',
      'page',
      '/wp/v2/pages/7',
    ],
    // Unknown type: the route in the link, without origin or subdirectory.
    [
      'https://example.com/blog/wp-json/wp/v2/things/7',
      'thing',
      '/wp/v2/things/7',
    ],
    // Plain permalinks.
    [
      'https://example.com/blog/?rest_route=/wp/v2/things/7',
      'thing',
      '/wp/v2/things/7',
    ],
    // A link that is no REST URL of this post.
    ['https://example.com/blog/?p=7', 'thing', '/wp/v2/posts/7'],
    ['https://example.com/wp-json/wp/v2/things/8', 'thing', '/wp/v2/posts/7'],
    ['not a url', null, '/wp/v2/posts/7'],
  ])('%s (%s) → %s', (href, postType, route) => {
    expect(parentRoute({ postId: 7, href, postType }, known)).toBe(route)
  })

  it('reads the route of REST URLs only', () => {
    expect(restRouteOf('https://example.com/a/wp-json/wp/v2/pages/1')).toBe(
      '/wp/v2/pages/1',
    )
    expect(restRouteOf('https://example.com/a/pages/1')).toBeNull()
  })
})
