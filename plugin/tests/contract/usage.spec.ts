// Contract tests for GET|POST /usage and the usage index (plugin-api.md §5.10, §8.2), track P2.
//
// The index is kept current by hooks, so most checks don't need a backfill. `complete`
// and the Visual Portfolio re-scan need P1's POST /maintenance/step; those parts are
// skipped while it answers 501.

import { beforeAll, describe, expect, it, vi } from 'vitest'
import { UsageResponseSchema } from '../../../shared/library-api.schema.ts'
import {
  author,
  type Credentials,
  canSwitchVariants,
  editor,
  type Json,
  makePng,
  plugin,
  rest,
  upload,
  variant,
  wpUrl,
} from './support/p2.ts'

// Uploads and image operations wait for WordPress to make every sub-size.
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 })

const ready = wpUrl !== '' && editor.user !== ''

/** Runs P1's maintenance step until nothing is left; false while the route isn't built. */
async function driveMaintenance(): Promise<boolean> {
  for (let step = 0; step < 200; step++) {
    const reply = await plugin('POST', '/maintenance/step', {
      body: { budgetMs: 5000 },
    })
    if (reply.status !== 200) return false
    if (!reply.json.more && !reply.json.locked) return true
  }
  return false
}

async function usageOf(
  ids: number[],
  as: Credentials | null = editor,
): Promise<Map<number, Json>> {
  const reply = await plugin('GET', `/usage?ids=${ids.join(',')}`, { as })
  expect(reply.status).toBe(200)
  UsageResponseSchema.parse(reply.json)
  return new Map(reply.json.items.map((item: Json) => [item.id, item]))
}

function contextsIn(item: Json, postId: number | null): string[] {
  return item.refs.find((ref: Json) => ref.postId === postId)?.contexts ?? []
}

const imageBlock = (media: Json) =>
  `<!-- wp:image {"id":${media.id},"sizeSlug":"large"} -->\n<figure class="wp-block-image size-large"><img src="${media.source_url}" alt="" class="wp-image-${media.id}"/></figure>\n<!-- /wp:image -->`

describe.skipIf(!ready)('GET|POST /usage', () => {
  const media: Json[] = []
  let post: number

  beforeAll(async () => {
    for (let index = 0; index < 5; index++) {
      media.push(
        await upload(`p2-usage-${index}.png`, makePng(400, 300), 'image/png'),
      )
    }
    const [a, b, c, d] = media
    const subSizeUrl = c.media_details.sizes?.medium?.source_url ?? c.source_url
    const content = [
      imageBlock(a),
      `<!-- wp:gallery {"linkTo":"none"} -->\n<figure class="wp-block-gallery has-nested-images">${imageBlock(b)}</figure>\n<!-- /wp:gallery -->`,
      `<!-- wp:paragraph -->\n<p>A link to <a href="${subSizeUrl}">a sub-size</a>.</p>\n<!-- /wp:paragraph -->`,
      `<!-- wp:shortcode -->\n[gallery ids="${d.id}"]\n<!-- /wp:shortcode -->`,
    ].join('\n\n')
    const created = await rest('POST', '/wp/v2/posts', {
      body: {
        title: 'P2 usage post',
        status: 'publish',
        content,
        featured_media: a.id,
      },
    })
    expect(created.status).toBe(201)
    post = created.json.id
  })

  it('finds each context, one ref per post with all its contexts', async () => {
    const [a, b, c, d, unused] = media
    const usage = await usageOf([a.id, b.id, c.id, d.id, unused.id, 999999])
    expect(contextsIn(usage.get(a.id), post)).toEqual([
      'featured',
      'image-block',
    ])
    expect(contextsIn(usage.get(b.id), post)).toEqual(['gallery-block'])
    expect(contextsIn(usage.get(c.id), post)).toEqual(['content'])
    expect(contextsIn(usage.get(d.id), post)).toEqual(['shortcode-gallery'])
    expect(usage.get(unused.id)).toEqual({ id: unused.id, count: 0, refs: [] })
    expect(usage.get(999999)).toEqual({ id: 999999, count: 0, refs: [] })

    const ref = usage.get(a.id).refs[0]
    expect(ref).toMatchObject({
      postId: post,
      postType: 'post',
      postTypeLabel: 'Post',
      title: 'P2 usage post',
      status: 'publish',
    })
    expect(ref.editUrl).toContain(`post=${post}`)
    expect(ref.viewUrl).toBeTruthy()
  })

  it('answers POST like GET, and keeps the request order', async () => {
    const ids = [media[3].id, media[0].id]
    const get = await plugin('GET', `/usage?ids=${ids.join(',')}`)
    const post = await plugin('POST', '/usage', { body: { ids } })
    expect(post.status).toBe(200)
    expect(post.json).toEqual(get.json)
    expect(post.json.items.map((item: Json) => item.id)).toEqual(ids)
  })

  it('follows post edits, and moves rev only when usage changed', async () => {
    const [a, b] = media
    const before = await plugin('GET', `/usage?ids=${a.id}`)
    await rest('POST', `/wp/v2/posts/${post}`, {
      body: { title: 'P2 usage post (renamed)' },
    })
    const renamed = await plugin('GET', `/usage?ids=${a.id}`)
    expect(renamed.json.rev).toBe(before.json.rev)

    await rest('POST', `/wp/v2/posts/${post}`, {
      body: { content: imageBlock(a) },
    })
    const after = await usageOf([a.id, b.id])
    expect(contextsIn(after.get(a.id), post)).toEqual([
      'featured',
      'image-block',
    ])
    expect(after.get(b.id).count).toBe(0)
    const changed = await plugin('GET', `/usage?ids=${a.id}`)
    expect(changed.json.rev).not.toBe(before.json.rev)
  })

  it('drops the refs of a trashed post', async () => {
    const extra = await rest('POST', '/wp/v2/posts', {
      body: {
        title: 'P2 trashed user',
        status: 'publish',
        content: imageBlock(media[4]),
      },
    })
    expect((await usageOf([media[4].id])).get(media[4].id).count).toBe(1)
    await rest('DELETE', `/wp/v2/posts/${extra.json.id}`)
    expect((await usageOf([media[4].id])).get(media[4].id).count).toBe(0)
  })

  it('lists site-level uses first, as postType "site"', async () => {
    const list = await rest('GET', '/wp/v2/media?per_page=100&_fields=id')
    const usage = await usageOf(list.json.map((item: Json) => item.id))
    const site = [...usage.values()]
      .flatMap((item: Json) => item.refs)
      .filter((ref: Json) => ref.postType === 'site')
    if (site.length === 0) return // The seed sets a logo and an icon; another stack may not.
    for (const ref of site) {
      expect(ref).toMatchObject({ postId: null, postTypeLabel: 'Site' })
      expect(['Site logo', 'Site icon']).toContain(ref.title)
    }
    for (const item of usage.values()) {
      const firstPostRef = item.refs.findIndex(
        (ref: Json) => ref.postId !== null,
      )
      const lastSiteRef = item.refs.findLastIndex(
        (ref: Json) => ref.postId === null,
      )
      if (firstPostRef >= 0 && lastSiteRef >= 0)
        expect(lastSiteRef).toBeLessThan(firstPostRef)
    }
  })

  it.each([
    ['no ids', ''],
    ['a zero id', '?ids=0'],
    ['junk', '?ids=1,abc'],
  ])('rejects %s with 400 wpu_invalid_param', async (_label, query) => {
    const reply = await plugin('GET', `/usage${query}`)
    expect(reply.status).toBe(400)
    expect(reply.json.code).toBe('wpu_invalid_param')
  })

  it('reads ids like every other route: integers only, duplicates answered once (§1.2, P-10)', async () => {
    const item = await upload('p2-usage-ids.png', makePng(20, 20), 'image/png')
    const get = await plugin('GET', `/usage?ids=${item.id},${item.id}`)
    expect(get.status).toBe(200)
    expect(get.json.items.map((entry: Json) => entry.id)).toEqual([item.id])
    const post = await plugin('POST', '/usage', {
      body: { ids: [item.id, item.id] },
    })
    expect(post.json.items.map((entry: Json) => entry.id)).toEqual([item.id])
    const float = await fetch(`${wpUrl}/wp-json/wp-upload/v1/usage`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${editor.user}:${editor.password}`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: `{"ids":[${item.id}.0]}`,
    })
    expect(float.status).toBe(400)
    expect(await float.json()).toMatchObject({
      code: 'wpu_invalid_param',
      data: { param: 'ids' },
    })
    await plugin('POST', '/media/delete', { body: { ids: [item.id] } })
  })

  it('rejects more than 100 ids with wpu_too_many_items', async () => {
    const reply = await plugin('POST', '/usage', {
      body: { ids: Array.from({ length: 101 }, (_, i) => i + 1) },
    })
    expect(reply.json).toMatchObject({
      code: 'wpu_too_many_items',
      data: { max: 100 },
    })
  })

  it('reports complete once the maintenance step has scanned everything', async () => {
    if (!(await driveMaintenance())) return // P1's /maintenance/step isn't built yet.
    const reply = await plugin('GET', `/usage?ids=${media[0].id}`)
    expect(reply.json.complete).toBe(true)
  })

  describe.skipIf(author === null)('as the Author', () => {
    it('shows another user’s private post as "Private post" without links', async () => {
      const image = await upload(
        'p2-usage-private.png',
        makePng(64, 64),
        'image/png',
      )
      const created = await rest('POST', '/wp/v2/posts', {
        body: {
          title: 'P2 private user',
          status: 'private',
          content: imageBlock(image),
        },
      })
      const asEditor = await usageOf([image.id])
      expect(asEditor.get(image.id).refs[0].title).toBe('P2 private user')
      const asAuthor = await usageOf([image.id], author)
      expect(asAuthor.get(image.id).refs[0]).toMatchObject({
        postId: created.json.id,
        title: 'Private post',
        editUrl: null,
        viewUrl: null,
      })
    })
  })
})

describe.skipIf(!ready)('Visual Portfolio usage (D22)', () => {
  let active = false
  const media: Json[] = []
  let post: number

  beforeAll(async () => {
    active = (await rest('GET', '/wp/v2/types/vp_lists')).status !== 404
    for (let index = 0; index < 3; index++) {
      media.push(
        await upload(`p2-vp-${index}.png`, makePng(64, 64), 'image/png'),
      )
    }
    const [a, b, c] = media
    const block = {
      block_id: 'p2test01',
      content_source: 'images',
      images: [
        { id: a.id, imgUrl: a.source_url },
        { imgUrl: 'https://example.com/external.jpg' },
      ],
    }
    const loop = {
      block_id: 'p2test02',
      queryType: 'images',
      imagesQuery: { images: [{ id: b.id }, { id: c.id }] },
    }
    const content = [
      `<!-- wp:visual-portfolio/block ${JSON.stringify(block)} /-->`,
      `<!-- wp:visual-portfolio/loop ${JSON.stringify(loop)} -->\n<div class="wp-block-visual-portfolio-loop"></div>\n<!-- /wp:visual-portfolio/loop -->`,
    ].join('\n\n')
    const created = await rest('POST', '/wp/v2/posts', {
      body: { title: 'P2 VP post', status: 'publish', content },
    })
    post = created.json.id
  })

  it('reads the block’s images and the Gallery Loop’s imagesQuery while Visual Portfolio is active', async () => {
    const usage = await usageOf(media.map((item) => item.id))
    for (const item of media) {
      expect(contextsIn(usage.get(item.id), post)).toEqual(
        active ? ['visual-portfolio'] : [],
      )
    }
  })

  it('reports saved layouts on the layout and on the posts that embed them', async () => {
    if (!active) return
    const list = await rest('GET', '/wp/v2/media?per_page=100&_fields=id')
    const usage = await usageOf(list.json.map((item: Json) => item.id))
    const byPost = new Map<number, Set<number>>()
    const layoutImages = new Set<number>()
    for (const item of usage.values()) {
      for (const ref of item.refs) {
        if (!ref.contexts.includes('visual-portfolio')) continue
        if (ref.postType === 'vp_lists') layoutImages.add(item.id)
        if (!byPost.has(ref.postId)) byPost.set(ref.postId, new Set())
        byPost.get(ref.postId)?.add(item.id)
      }
    }
    const embeds = await rest(
      'GET',
      '/wp/v2/posts?search=saved%20layouts&_fields=id,title',
    )
    if (layoutImages.size === 0 || embeds.json.length === 0) return // No seeded saved layouts (track D's seed).
    for (const embed of embeds.json) {
      expect([...(byPost.get(embed.id) ?? [])].sort()).toEqual(
        [...layoutImages].sort(),
      )
    }
  })

  it.skipIf(!canSwitchVariants())(
    'drops and restores the context when Visual Portfolio is switched off and on',
    async () => {
      if (!active) return
      toggleVisualPortfolio(false)
      try {
        const off = await usageOf([media[0].id])
        expect(contextsIn(off.get(media[0].id), post)).toEqual([])
      } finally {
        toggleVisualPortfolio(true)
      }
      if (!(await driveMaintenance())) {
        // Without P1's maintenance step, a save rescans the post.
        await rest('POST', `/wp/v2/posts/${post}`, {
          body: { title: 'P2 VP post (rescanned)' },
        })
      }
      const on = await usageOf([media[0].id])
      expect(contextsIn(on.get(media[0].id), post)).toEqual([
        'visual-portfolio',
      ])
    },
  )
})

/** Track D's `vp=` variant (hides Visual Portfolio without deactivating it). */
function toggleVisualPortfolio(on: boolean): void {
  variant(`vp=${on ? 'on' : 'off'}`)
}
