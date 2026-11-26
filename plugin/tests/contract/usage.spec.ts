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
import { wpEvalAvailable, wpEvalJson } from './support/variants.ts'

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
      expect([
        'Site logo',
        'Site icon',
        'Visual Portfolio placeholder image',
      ]).toContain(ref.title)
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

describe.skipIf(!ready)('[gallery] without ids (D40)', () => {
  let post: number
  let other: number
  const images: Json[] = []

  /** Uploads a PNG attached to `parent` (core REST's `post` field). */
  async function uploadAttached(name: string, parent: number): Promise<Json> {
    const form = new FormData()
    form.append(
      'file',
      new Blob([new Uint8Array(makePng(32, 32))], { type: 'image/png' }),
      name,
    )
    form.append('post', String(parent))
    const reply = await rest('POST', '/wp/v2/media', { form })
    expect(reply.status).toBe(201)
    return reply.json
  }

  const galleryOf = async (id: number, source: number) =>
    contextsIn((await usageOf([id])).get(id), source)

  beforeAll(async () => {
    // A classic post (no blocks) with an id-less gallery, and a block post whose
    // gallery shows the first post's attached images minus one.
    const created = await rest('POST', '/wp/v2/posts', {
      body: {
        title: 'P2 attached gallery',
        status: 'publish',
        content: 'Our photos:\n\n[gallery columns="2"]',
      },
    })
    expect(created.status).toBe(201)
    post = created.json.id
    images.push(await uploadAttached('p2-attached-0.png', post))
    images.push(await uploadAttached('p2-attached-1.png', post))
    const elsewhere = await rest('POST', '/wp/v2/posts', {
      body: {
        title: 'P2 gallery of another post',
        status: 'draft',
        content: `<!-- wp:shortcode -->\n[gallery id="${post}" exclude="${images[1].id}"]\n<!-- /wp:shortcode -->`,
      },
    })
    expect(elsewhere.status).toBe(201)
    other = elsewhere.json.id
  })

  it('counts the images attached to the post as shortcode-gallery, also from [gallery id=N]', async () => {
    const [shown, excluded] = images
    expect(await galleryOf(shown.id, post)).toEqual(['shortcode-gallery'])
    expect(await galleryOf(excluded.id, post)).toEqual(['shortcode-gallery'])
    expect(await galleryOf(shown.id, other)).toEqual(['shortcode-gallery'])
    expect(await galleryOf(excluded.id, other)).toEqual([])
  })

  it('follows detach and attach through core REST and /media/batch', async () => {
    const [shown] = images
    const detached = await rest('POST', `/wp/v2/media/${shown.id}`, {
      body: { post: 0 },
    })
    expect(detached.status).toBe(200)
    expect(await galleryOf(shown.id, post)).toEqual([])
    expect(await galleryOf(shown.id, other)).toEqual([])

    const attached = await plugin('POST', '/media/batch', {
      body: { items: [{ id: shown.id, set: { post } }] },
    })
    expect(attached.status).toBe(200)
    expect(attached.json.results[0].ok).toBe(true)
    expect(await galleryOf(shown.id, post)).toEqual(['shortcode-gallery'])
    expect(await galleryOf(shown.id, other)).toEqual(['shortcode-gallery'])
  })

  it.skipIf(!wpEvalAvailable)(
    'follows wp-admin’s Attach and Detach (wp_media_attach_action)',
    async () => {
      const [shown] = images
      // What wp_media_attach_action() does: SQL, then the action per item.
      const move = (parent: number, action: string, hookParent: number) =>
        wpEvalJson(`
          global $wpdb;
          $wpdb->update( $wpdb->posts, array( 'post_parent' => ${parent} ), array( 'ID' => ${shown.id} ) );
          do_action( 'wp_media_attach_action', '${action}', ${shown.id}, ${hookParent} );
          clean_attachment_cache( ${shown.id} );
          echo 'true';
        `)
      move(0, 'detach', post)
      expect(await galleryOf(shown.id, post)).toEqual([])
      move(post, 'attach', post)
      expect(await galleryOf(shown.id, post)).toEqual(['shortcode-gallery'])
    },
  )

  it.skipIf(!canSwitchVariants())(
    'drops a trashed attached image from the gallery and brings it back on restore (trash=on)',
    async () => {
      const [shown] = images
      variant('trash=on')
      try {
        const trashed = await plugin('POST', '/media/trash', {
          body: { ids: [shown.id] },
        })
        expect(trashed.status).toBe(200)
        expect(trashed.json.results[0].ok).toBe(true)
        expect(await galleryOf(shown.id, post)).toEqual([])
        expect(await galleryOf(shown.id, other)).toEqual([])

        const restored = await plugin('POST', '/trash/restore', {
          body: { ids: [shown.id] },
        })
        expect(restored.status).toBe(200)
        expect(restored.json.results[0].ok).toBe(true)
        expect(await galleryOf(shown.id, post)).toEqual(['shortcode-gallery'])
        expect(await galleryOf(shown.id, other)).toEqual(['shortcode-gallery'])
      } finally {
        variant('trash=off')
      }
    },
  )

  it.skipIf(!wpEvalAvailable)(
    'rescans once per request, and never for non-images (one gallery query for many events)',
    async () => {
      const [shown] = images
      const result = wpEvalJson(`
        use WpUpload\\Companion\\Index\\UsageIndex;
        $queries = 0;
        add_filter( 'query', function ( $sql ) use ( &$queries ) {
          if ( false !== strpos( $sql, '[gallery' ) ) {
            $queries++;
          }
          return $sql;
        } );
        $before = clone get_post( ${shown.id} );
        $after  = clone $before;
        $after->post_status = 'trash';
        // Three changes in one request (as /media/trash with three ids would make).
        for ( $i = 0; $i < 3; $i++ ) {
          UsageIndex::on_attachment_updated( ${shown.id}, $after, $before );
        }
        UsageIndex::flush_gallery_parents();
        $for_images = $queries;
        $queries    = 0;
        // The same change to a non-image: no [gallery] shows it.
        $before->post_mime_type = 'application/pdf';
        $after->post_mime_type  = 'application/pdf';
        UsageIndex::on_attachment_updated( ${shown.id}, $after, $before );
        UsageIndex::flush_gallery_parents();
        echo wp_json_encode( array( $for_images, $queries ) );
      `)
      expect(result).toEqual([1, 0])
      // Nothing really changed, so the rescans found the same usage.
      expect(await galleryOf(shown.id, post)).toEqual(['shortcode-gallery'])
    },
  )
  it('adds a new upload attached to the post at once', async () => {
    const late = await uploadAttached('p2-attached-late.png', post)
    expect(await galleryOf(late.id, post)).toEqual(['shortcode-gallery'])
    await rest('DELETE', `/wp/v2/media/${late.id}?force=true`)
  })
})

describe.skipIf(!ready || !wpEvalAvailable)(
  'rescans after a parser upgrade or a deferred rescan (complete stays honest)',
  () => {
    const complete = async () =>
      (await plugin('GET', '/usage?ids=1')).json.complete as boolean
    const outdatedRows = () =>
      Number(
        wpEvalJson(
          `global $wpdb; echo wp_json_encode( (int) $wpdb->get_var( 'SELECT COUNT(*) FROM ' . $wpdb->prefix . 'wpu_usage_sources WHERE row_version < ' . WpUpload\\Companion\\Index\\UsageIndex::ROW_VERSION ) );`,
        ),
      )

    it('is incomplete after an update with a new parser, until every post is rescanned', async () => {
      expect(await driveMaintenance()).toBe(true)
      expect(await complete()).toBe(true)
      // What an index built by the previous release (parser 2) looks like.
      wpEvalJson(`
        $state = get_option( 'wpu_usage_index_state' );
        $state['parser'] = 2;
        update_option( 'wpu_usage_index_state', $state );
        global $wpdb;
        $wpdb->query( 'UPDATE ' . $wpdb->prefix . 'wpu_usage_sources SET row_version = 2' );
        echo 'true';
      `)
      expect(await complete()).toBe(false)
      expect(outdatedRows()).toBeGreaterThan(0)
      expect(await driveMaintenance()).toBe(true)
      expect(await complete()).toBe(true)
      expect(outdatedRows()).toBe(0)
    })

    it('is incomplete while posts left for the maintenance step wait', async () => {
      expect(await driveMaintenance()).toBe(true)
      // A rescan that deferred a post (row_version 0), then the /info consistency check.
      wpEvalJson(`
        global $wpdb;
        $wpdb->query( 'UPDATE ' . $wpdb->prefix . 'wpu_usage_sources SET row_version = 0 WHERE source_id > 0 ORDER BY source_id LIMIT 1' );
        WpUpload\\Companion\\Index\\UsageIndex::check_consistency( false );
        echo 'true';
      `)
      expect(await complete()).toBe(false)
      expect(await driveMaintenance()).toBe(true)
      expect(await complete()).toBe(true)
      expect(outdatedRows()).toBe(0)
    })
  },
)

describe.skipIf(!ready || !wpEvalAvailable)(
  'Visual Portfolio’s placeholder image (D44)',
  () => {
    let placeholder = 0

    beforeAll(async () => {
      placeholder = Number(
        wpEvalJson(
          "$general = get_option( 'vp_general' ); echo wp_json_encode( is_array( $general ) ? (int) ( $general['no_image'] ?? 0 ) : 0 );",
        ),
      )
    })

    it('is used by Visual Portfolio, as a site-level ref', async () => {
      if (placeholder <= 0) return // No Visual Portfolio on this stack.
      const item = (await usageOf([placeholder])).get(placeholder)
      expect(item.count).toBe(1)
      expect(item.refs[0]).toMatchObject({
        postId: null,
        postType: 'site',
        postTypeLabel: 'Site',
        title: 'Visual Portfolio placeholder image',
        viewUrl: null,
        contexts: ['visual-portfolio'],
      })
      // The app user is an Editor: no access to Visual Portfolio's settings.
      expect(item.refs[0].editUrl).toBeNull()
    })

    it('follows the option, and Visual Portfolio being switched off and on', async () => {
      if (placeholder <= 0) return
      const other = await upload(
        'p2-vp-placeholder.png',
        makePng(16, 16),
        'image/png',
      )
      const setPlaceholder = (id: number) =>
        wpEvalJson(
          `$general = get_option( 'vp_general' ); $general['no_image'] = ${id}; update_option( 'vp_general', $general ); echo 'true';`,
        )
      try {
        setPlaceholder(other.id)
        const swapped = await usageOf([placeholder, other.id])
        expect(swapped.get(placeholder).count).toBe(0)
        expect(contextsIn(swapped.get(other.id), null)).toEqual([
          'visual-portfolio',
        ])
      } finally {
        setPlaceholder(placeholder)
      }
      expect((await usageOf([placeholder])).get(placeholder).count).toBe(1)

      if (!canSwitchVariants()) return
      toggleVisualPortfolio(false)
      try {
        expect((await usageOf([placeholder])).get(placeholder).count).toBe(0)
      } finally {
        toggleVisualPortfolio(true)
      }
      expect(await driveMaintenance()).toBe(true)
      expect((await usageOf([placeholder])).get(placeholder).count).toBe(1)
    })
  },
)

/** Track D's `vp=` variant (hides Visual Portfolio without deactivating it). */
function toggleVisualPortfolio(on: boolean): void {
  variant(`vp=${on ? 'on' : 'off'}`)
}
