// Contract tests for POST /media/batch (plugin-api.md §5.4), track P2.
//
// They run over HTTP against this worktree's WordPress (`dev/run up test` in CI,
// `dev/run up dev` locally), as the Editor app user and, when the stack has one,
// the separate Author user (D26).

import { beforeAll, describe, expect, it, vi } from 'vitest'
import { PluginMediaBatchResponseSchema } from '../../../shared/library-api.schema.ts'
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

describe.skipIf(!ready)('POST /media/batch', () => {
  // Uploaded by the Editor, so it is "another user's item" for the Author.
  let mine: number
  let parentPost: number

  beforeAll(async () => {
    mine = (await upload('p2-batch-mine.png', makePng(64, 48), 'image/png')).id
    const post = await rest('POST', '/wp/v2/posts', {
      body: { title: 'P2 batch parent', status: 'draft' },
    })
    parentPost = post.json.id
  })

  it('writes title, alt, caption and description, and answers with previous and stored values', async () => {
    const before = await plugin('GET', '/rev')
    const reply = await plugin('POST', '/media/batch', {
      body: {
        items: [
          {
            id: mine,
            set: {
              title: 'Tom & Jerry',
              alt: 'An <b>alt</b>',
              caption: 'Cap',
              description: 'Desc',
            },
          },
        ],
      },
    })
    expect(reply.status).toBe(200)
    PluginMediaBatchResponseSchema.parse(reply.json)
    const [result] = reply.json.results
    expect(result.ok).toBe(true)
    expect(result.previous).toEqual({
      title: 'p2-batch-mine',
      alt: '',
      caption: '',
      description: '',
    })
    expect(result.item).toMatchObject({
      title: 'Tom & Jerry',
      alt: 'An alt',
      caption: 'Cap',
      description: 'Desc',
      post: null,
    })
    expect(reply.json.remaining).toEqual([])
    if (before.status === 200) expect(reply.json.rev).not.toBe(before.json.rev)
  })

  it('leaves modifiedAt alone for an alt-only change', async () => {
    const first = await plugin('POST', '/media/batch', {
      body: { items: [{ id: mine, set: { caption: 'Again' } }] },
    })
    const modifiedAt = first.json.results[0].item.modifiedAt
    await new Promise((resolve) => setTimeout(resolve, 1100))
    const reply = await plugin('POST', '/media/batch', {
      body: { items: [{ id: mine, set: { alt: 'Only alt' } }] },
    })
    expect(reply.json.results[0].item.alt).toBe('Only alt')
    expect(reply.json.results[0].item.modifiedAt).toBe(modifiedAt)
  })

  it('succeeds without changes when nothing differs', async () => {
    const reply = await plugin('POST', '/media/batch', {
      body: { items: [{ id: mine, set: { caption: 'Again' } }] },
    })
    expect(reply.json.results[0]).toMatchObject({
      ok: true,
      previous: { caption: 'Again' },
      item: { caption: 'Again' },
    })
  })

  it('appends a paragraph to the description', async () => {
    await plugin('POST', '/media/batch', {
      body: { items: [{ id: mine, set: { description: 'First  \n' } }] },
    })
    const reply = await plugin('POST', '/media/batch', {
      body: { items: [{ id: mine, set: {}, appendDescription: 'Second' }] },
    })
    expect(reply.json.results[0].previous).toEqual({ description: 'First  \n' })
    expect(reply.json.results[0].item.description).toBe('First\n\nSecond')
  })

  it('attaches and detaches with set.post', async () => {
    const attach = await plugin('POST', '/media/batch', {
      body: { items: [{ id: mine, set: { post: parentPost } }] },
    })
    expect(attach.json.results[0]).toMatchObject({
      ok: true,
      previous: { post: null },
      item: { post: parentPost },
    })
    const detach = await plugin('POST', '/media/batch', {
      body: { items: [{ id: mine, set: { post: null } }] },
    })
    expect(detach.json.results[0]).toMatchObject({
      ok: true,
      previous: { post: parentPost },
      item: { post: null },
    })
  })

  it('reports per-item errors without failing the request', async () => {
    const reply = await plugin('POST', '/media/batch', {
      body: {
        items: [
          { id: 999999, set: { caption: 'x' } },
          { id: mine, set: { post: 999999 } },
          { id: mine, set: { post: mine } },
        ],
      },
    })
    expect(reply.status).toBe(200)
    expect(reply.json.results.map((r: Json) => r.error?.code)).toEqual([
      'wpu_not_found',
      'wpu_post_not_found',
      'wpu_invalid_parent',
    ])
  })

  it.each([
    ['an unknown body key', { items: [], extra: 1 }, 'extra'],
    [
      'an unknown set key',
      { items: [{ id: 1, set: { colour: 'red' } }] },
      'items[0].set.colour',
    ],
    ['an empty set', { items: [{ id: 1, set: {} }] }, 'items[0].set'],
    ['post 0', { items: [{ id: 1, set: { post: 0 } }] }, 'items[0].set.post'],
    [
      'description with appendDescription',
      { items: [{ id: 1, set: { description: 'a' }, appendDescription: 'b' }] },
      'items[0].appendDescription',
    ],
    [
      'a title over 1000 characters',
      { items: [{ id: 1, set: { title: 'x'.repeat(1001) } }] },
      'items[0].set.title',
    ],
    ['no items', { items: [] }, 'items'],
  ])('rejects %s with 400 wpu_invalid_param', async (_label, body, param) => {
    const reply = await plugin('POST', '/media/batch', { body })
    expect(reply.status).toBe(400)
    expect(reply.json.code).toBe('wpu_invalid_param')
    expect(reply.json.data.param).toBe(param)
  })

  it('rejects more than 100 items with wpu_too_many_items', async () => {
    const items = Array.from({ length: 101 }, (_, index) => ({
      id: index + 1,
      set: { caption: 'x' },
    }))
    const reply = await plugin('POST', '/media/batch', { body: { items } })
    expect(reply.status).toBe(400)
    expect(reply.json).toMatchObject({
      code: 'wpu_too_many_items',
      data: { max: 100 },
    })
  })

  it('answers 403 wpu_forbidden, never 401, without credentials', async () => {
    const reply = await plugin('POST', '/media/batch', {
      body: { items: [{ id: mine, set: { caption: 'x' } }] },
      as: null,
    })
    expect(reply.status).toBe(403)
    expect(reply.json.code).toBe('wpu_forbidden')
  })

  describe.skipIf(!author)('as the Author', () => {
    it('edits own items and reports wpu_forbidden for other users’ items', async () => {
      const own = (
        await upload(
          'p2-batch-author.png',
          makePng(32, 32),
          'image/png',
          author as Credentials,
        )
      ).id
      const reply = await plugin('POST', '/media/batch', {
        as: author,
        body: {
          items: [
            {
              id: own,
              set: {
                caption: 'Mine',
                description: '<script>alert(1)</script>Text',
              },
            },
            { id: mine, set: { caption: 'Not mine' } },
          ],
        },
      })
      expect(reply.status).toBe(200)
      expect(reply.json.results[0]).toMatchObject({
        ok: true,
        item: { caption: 'Mine' },
      })
      // kses applies for users without unfiltered_html.
      expect(reply.json.results[0].item.description).not.toContain('<script>')
      expect(reply.json.results[1]).toMatchObject({
        ok: false,
        error: { code: 'wpu_forbidden' },
      })
    })

    it('can’t attach to a post the Author may not edit', async () => {
      const own = (
        await upload(
          'p2-batch-author2.png',
          makePng(32, 32),
          'image/png',
          author as Credentials,
        )
      ).id
      const reply = await plugin('POST', '/media/batch', {
        as: author,
        body: { items: [{ id: own, set: { post: parentPost } }] },
      })
      expect(reply.json.results[0]).toMatchObject({
        ok: false,
        error: { code: 'wpu_forbidden' },
      })
    })
  })

  describe.skipIf(author !== null || !canSwitchVariants())(
    'as the app user switched to Author (role=author)',
    () => {
      it('reports wpu_forbidden for items the user doesn’t own', async () => {
        const list = await rest(
          'GET',
          '/wp/v2/media?per_page=20&_fields=id,author',
        )
        const me = await rest('GET', '/wp/v2/users/me')
        const foreign = list.json.find(
          (item: Json) => item.author !== me.json.id,
        )
        variant('role=author')
        try {
          const reply = await plugin('POST', '/media/batch', {
            body: {
              items: [
                { id: foreign.id, set: { caption: 'x' } },
                { id: mine, set: { caption: 'Mine' } },
              ],
            },
          })
          expect(reply.status).toBe(200)
          expect(reply.json.results[0]).toMatchObject({
            ok: false,
            error: { code: 'wpu_forbidden' },
          })
          expect(reply.json.results[1]).toMatchObject({ ok: true })
        } finally {
          variant('role=editor')
        }
      })
    },
  )
})
