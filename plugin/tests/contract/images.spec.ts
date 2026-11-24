// Contract tests for the image operations (plugin-api.md §5.11–5.15, §8.3), track P2.
//
// Every check works on real files: dimensions are read from the bytes served at the
// item's URL, and Undo and Restore must bring back byte-identical files at the same URL.

import { createHash } from 'node:crypto'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { PluginImageOpResponseSchema } from '../../../shared/library-api.schema.ts'
import {
  author,
  type Credentials,
  editor,
  type Json,
  makePng,
  plugin,
  rest,
  upload,
  wpUrl,
} from './support/p2.ts'

// Uploads and image operations wait for WordPress to make every sub-size.
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 })

const ready = wpUrl !== '' && editor.user !== ''

async function download(url: string): Promise<Buffer> {
  const response = await fetch(
    `${url}${url.includes('?') ? '&' : '?'}nocache=${Date.now()}`,
  )
  expect(response.status).toBe(200)
  return Buffer.from(await response.arrayBuffer())
}

const sha256 = (bytes: Buffer) =>
  createHash('sha256').update(bytes).digest('hex')

/** Width and height from a PNG's IHDR or a JPEG's SOF marker. */
function dimensions(bytes: Buffer): { width: number; height: number } {
  if (bytes.subarray(1, 4).toString('ascii') === 'PNG') {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
  }
  let offset = 2
  while (offset < bytes.length) {
    const marker = bytes[offset + 1] ?? 0
    const length = bytes.readUInt16BE(offset + 2)
    if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      ![0xc4, 0xc8, 0xcc].includes(marker)
    ) {
      return {
        height: bytes.readUInt16BE(offset + 5),
        width: bytes.readUInt16BE(offset + 7),
      }
    }
    offset += 2 + length
  }
  throw new Error('Not a PNG or JPEG')
}

async function media(id: number): Promise<Json> {
  const reply = await rest('GET', `/wp/v2/media/${id}?context=edit`)
  expect(reply.status).toBe(200)
  return reply.json
}

const modifiedAt = async (id: number) => `${(await media(id)).modified_gmt}Z`

async function operation(
  id: number,
  route: string,
  body: Record<string, unknown> = {},
  as: Credentials = editor,
) {
  const expectedModified = await modifiedAt(id)
  return plugin('POST', `/media/${id}/${route}`, {
    body: { expectedModified, ...body },
    as,
  })
}

async function replaceWith(
  id: number,
  name: string,
  bytes: Buffer,
  mime: string,
  expected?: string,
) {
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(bytes)], { type: mime }), name)
  form.append('expectedModified', expected ?? (await modifiedAt(id)))
  return plugin('POST', `/media/${id}/replace`, { form })
}

/** A JPEG from the seed, uploaded again so the tests own their copy. */
async function jpegCopy(name: string, minWidth = 800): Promise<Json> {
  const list = await rest(
    'GET',
    '/wp/v2/media?mime_type=image/jpeg&per_page=100&_fields=source_url,media_details',
  )
  const source = list.json.find(
    (item: Json) =>
      !item.media_details.original_image &&
      item.media_details.width >= minWidth,
  )
  return upload(name, await download(source.source_url), 'image/jpeg')
}

/** The unscaled original of a seeded `-scaled` image, larger than the 2560 px threshold. */
async function bigJpeg(): Promise<Buffer | null> {
  const list = await rest(
    'GET',
    '/wp/v2/media?mime_type=image/jpeg&per_page=100&_fields=source_url,media_details',
  )
  const scaled = list.json.find(
    (item: Json) =>
      item.media_details.original_image &&
      Math.max(item.media_details.width, item.media_details.height) === 2560,
  )
  if (!scaled) return null
  const folder = scaled.source_url.slice(
    0,
    scaled.source_url.lastIndexOf('/') + 1,
  )
  return download(folder + scaled.media_details.original_image)
}

describe.skipIf(!ready)('Image operations', () => {
  let item: Json
  let originalBytes: Buffer
  let originalSize: { width: number; height: number }

  beforeAll(async () => {
    item = await jpegCopy('p2-edit.jpg')
    originalBytes = await download(item.source_url)
    originalSize = dimensions(originalBytes)
  })

  it('rotates in place: same URL, new pixels, swapped dimensions and sub-sizes', async () => {
    const reply = await operation(item.id, 'edit', {
      ops: [{ op: 'rotate', angle: 90 }],
      applyTo: 'all',
    })
    expect(reply.status).toBe(200)
    PluginImageOpResponseSchema.parse(reply.json)
    expect(reply.json).toMatchObject({
      id: item.id,
      width: originalSize.height,
      height: originalSize.width,
      mime: 'image/jpeg',
      urlChanged: false,
      edited: true,
      undoable: true,
      restorable: true,
    })
    expect(reply.json.sizesRegenerated).toBeGreaterThan(0)

    const after = await media(item.id)
    expect(after.source_url).toBe(item.source_url)
    expect(`${after.modified_gmt}Z`).toBe(reply.json.modifiedAt)
    const bytes = await download(item.source_url)
    expect(sha256(bytes)).not.toBe(sha256(originalBytes))
    expect(dimensions(bytes)).toEqual({
      width: originalSize.height,
      height: originalSize.width,
    })
    const medium = after.media_details.sizes.medium
    expect(medium.width < medium.height).toBe(
      originalSize.height < originalSize.width,
    )
    expect(dimensions(await download(medium.source_url))).toEqual({
      width: medium.width,
      height: medium.height,
    })
  })

  it('refuses a stale expectedModified with 409 wpu_stale', async () => {
    const current = await modifiedAt(item.id)
    const reply = await plugin('POST', `/media/${item.id}/edit`, {
      body: {
        ops: [{ op: 'flipH' }],
        applyTo: 'all',
        expectedModified: '2000-01-01T00:00:00Z',
      },
    })
    expect(reply.status).toBe(409)
    expect(reply.json).toMatchObject({
      code: 'wpu_stale',
      data: { modifiedAt: current },
    })
  })

  it('undoes back to the byte-identical original', async () => {
    const reply = await operation(item.id, 'edit/undo')
    expect(reply.status).toBe(200)
    expect(reply.json).toMatchObject({
      width: originalSize.width,
      height: originalSize.height,
      edited: false,
      undoable: false,
      restorable: false,
    })
    expect(sha256(await download(item.source_url))).toBe(sha256(originalBytes))
    const nothing = await operation(item.id, 'edit/undo')
    expect(nothing.status).toBe(409)
    expect(nothing.json.code).toBe('wpu_nothing_to_undo')
    const notEdited = await operation(item.id, 'restore')
    expect(notEdited.status).toBe(409)
    expect(notEdited.json.code).toBe('wpu_not_edited')
  })

  it('applies rotate, crop and scale in order, then restores the original after several edits', async () => {
    const recipe = {
      ops: [
        { op: 'rotate', angle: 270 },
        { op: 'crop', x: 10, y: 20, width: 400, height: 300 },
        { op: 'flipV' },
      ],
      scale: { width: 200, height: 150 },
      applyTo: 'all',
    }
    const edited = await operation(item.id, 'edit', recipe)
    expect(edited.status).toBe(200)
    expect(edited.json).toMatchObject({ width: 200, height: 150 })
    expect(dimensions(await download(item.source_url))).toEqual({
      width: 200,
      height: 150,
    })

    const second = await operation(item.id, 'edit', {
      ops: [{ op: 'rotate', angle: 180 }],
      applyTo: 'all',
    })
    expect(second.json).toMatchObject({
      width: 200,
      height: 150,
      undoable: true,
    })

    const undone = await operation(item.id, 'edit/undo')
    expect(undone.json).toMatchObject({
      width: 200,
      height: 150,
      undoable: true,
      restorable: true,
    })

    const restored = await operation(item.id, 'restore')
    expect(restored.status).toBe(200)
    expect(restored.json).toMatchObject({
      width: originalSize.width,
      height: originalSize.height,
      edited: false,
      restorable: false,
      urlChanged: false,
    })
    expect(sha256(await download(item.source_url))).toBe(sha256(originalBytes))
  })

  it('edits only the thumbnail with applyTo thumbnail, and everything else with nothumb', async () => {
    const thumbnailUrl = (await media(item.id)).media_details.sizes.thumbnail
      .source_url
    const thumbnailBefore = sha256(await download(thumbnailUrl))

    await operation(item.id, 'edit', {
      ops: [{ op: 'crop', x: 0, y: 0, width: 300, height: 100 }],
      applyTo: 'thumbnail',
    })
    expect(sha256(await download(item.source_url))).toBe(sha256(originalBytes))
    const thumbnail = (await media(item.id)).media_details.sizes.thumbnail
    expect(dimensions(await download(thumbnail.source_url))).toEqual({
      width: thumbnail.width,
      height: thumbnail.height,
    })
    expect(thumbnail.width / thumbnail.height).toBeCloseTo(3, 0)

    await operation(item.id, 'restore')
    expect(sha256(await download(thumbnailUrl))).toBe(thumbnailBefore)

    await operation(item.id, 'edit', {
      ops: [{ op: 'flipH' }],
      applyTo: 'nothumb',
    })
    expect(sha256(await download(thumbnailUrl))).toBe(thumbnailBefore)
    expect(sha256(await download(item.source_url))).not.toBe(
      sha256(originalBytes),
    )
    await operation(item.id, 'restore')
  })

  it.each([
    [
      'a crop outside the image',
      { ops: [{ op: 'crop', x: 0, y: 0, width: 99999, height: 10 }] },
    ],
    ['nothing to do', { ops: [] }],
    [
      'a scale that isn’t proportional',
      { ops: [], scale: { width: 100, height: 10 } },
    ],
    [
      'a scale larger than the image',
      { ops: [], scale: { width: 99999, height: 99999 } },
    ],
  ])('refuses %s with 400 wpu_invalid_edit', async (_label, recipe) => {
    const reply = await operation(item.id, 'edit', {
      applyTo: 'all',
      ...recipe,
    })
    expect(reply.status).toBe(400)
    expect(reply.json.code).toBe('wpu_invalid_edit')
    expect(typeof reply.json.data.reason).toBe('string')
  })

  it.each([
    [
      'an unknown angle',
      { ops: [{ op: 'rotate', angle: 45 }], applyTo: 'all' },
      'ops[0].angle',
    ],
    [
      'an unknown op field',
      { ops: [{ op: 'flipH', axis: 1 }], applyTo: 'all' },
      'ops[0].axis',
    ],
    [
      'an unknown applyTo',
      { ops: [{ op: 'flipH' }], applyTo: 'some' },
      'applyTo',
    ],
    [
      'more than 20 ops',
      {
        ops: Array.from({ length: 21 }, () => ({ op: 'flipH' })),
        applyTo: 'all',
      },
      'ops',
    ],
  ])('refuses %s as a malformed request', async (_label, recipe, param) => {
    const reply = await operation(item.id, 'edit', recipe)
    expect(reply.status).toBe(400)
    expect(['wpu_invalid_param', 'wpu_too_many_items']).toContain(
      reply.json.code,
    )
    expect(reply.json.data.param).toBe(param)
  })

  it('answers 404 for an unknown item, before anything else', async () => {
    const reply = await plugin('POST', '/media/999999/edit', { body: {} })
    expect(reply.status).toBe(404)
    expect(reply.json.code).toBe('wpu_not_found')
  })

  it('lets one of two concurrent edits run and refuses the other with 409', async () => {
    const expectedModified = await modifiedAt(item.id)
    const body = {
      ops: [{ op: 'rotate', angle: 90 }],
      applyTo: 'all',
      expectedModified,
    }
    const replies = await Promise.all([
      plugin('POST', `/media/${item.id}/edit`, { body }),
      plugin('POST', `/media/${item.id}/edit`, { body }),
    ])
    const statuses = replies.map((reply) => reply.status).sort()
    expect(statuses).toEqual([200, 409])
    const refused = replies.find((reply) => reply.status === 409)
    expect(['wpu_locked', 'wpu_stale']).toContain(refused?.json.code)
    await operation(item.id, 'restore')
  })

  it('regenerates every sub-size and keeps in-place edits', async () => {
    await operation(item.id, 'edit', { ops: [{ op: 'flipH' }], applyTo: 'all' })
    const editedBytes = sha256(await download(item.source_url))
    const reply = await plugin('POST', `/media/${item.id}/regenerate`, {
      body: {},
    })
    expect(reply.status).toBe(200)
    PluginImageOpResponseSchema.parse(reply.json)
    // REST adds a `full` entry to the stored sizes.
    const sizes = Object.keys(
      (await media(item.id)).media_details.sizes,
    ).filter((name) => name !== 'full')
    expect(reply.json.sizesRegenerated).toBe(sizes.length)
    expect(reply.json).toMatchObject({
      edited: true,
      undoable: true,
      urlChanged: false,
    })
    expect(sha256(await download(item.source_url))).toBe(editedBytes)
    await operation(item.id, 'restore')
    expect(sha256(await download(item.source_url))).toBe(sha256(originalBytes))
  })

  // Regression (review finding 3): regenerate wrote its outputs over the live sub-size
  // files in place, which changed the recorded original's thumbnail (a hard link).
  it('keeps the original thumbnail through nothumb edit, regenerate and restore', async () => {
    const sizes = async () => (await media(item.id)).media_details.sizes
    const thumbnailUrl = (await sizes()).thumbnail.source_url
    const before = sha256(await download(thumbnailUrl))
    await operation(item.id, 'edit', {
      ops: [{ op: 'flipH' }],
      applyTo: 'nothumb',
    })
    const regenerated = await plugin('POST', `/media/${item.id}/regenerate`, {
      body: {},
    })
    expect(regenerated.json).toMatchObject({ undoable: true, restorable: true })
    // Every size is served while and after it is rebuilt.
    for (const size of Object.values(await sizes()) as Json[]) {
      expect((await fetch(size.source_url)).status).toBe(200)
    }
    const restored = await operation(item.id, 'restore')
    expect(restored.status).toBe(200)
    expect(sha256(await download(thumbnailUrl))).toBe(before)
    expect(sha256(await download(item.source_url))).toBe(sha256(originalBytes))
  })

  // Regression (review finding 4): a PDF regenerate discarded the old previews and
  // answered 200 even when no preview could be rendered.
  it('regenerates a PDF preview under the same names, or refuses with 415', async () => {
    const list = await rest(
      'GET',
      '/wp/v2/media?mime_type=application/pdf&per_page=1&_fields=id',
    )
    if (list.json.length === 0) return
    const id = list.json[0].id
    const first = await plugin('POST', `/media/${id}/regenerate`, { body: {} })
    if (first.status === 415) {
      expect(first.json).toMatchObject({
        code: 'wpu_unsupported_type',
        data: { mime: 'application/pdf' },
      })
      return
    }
    expect(first.status).toBe(200)
    const sizes = (await media(id)).media_details.sizes
    expect(sizes.full.source_url).toMatch(/-pdf\.jpg$/)
    expect(first.json.sizesRegenerated).toBe(Object.keys(sizes).length)
    const again = await plugin('POST', `/media/${id}/regenerate`, { body: {} })
    expect(again.status).toBe(200)
    const sizesAgain = (await media(id)).media_details.sizes
    expect(sizesAgain.full.source_url).toBe(sizes.full.source_url)
    for (const size of Object.values(sizesAgain) as Json[]) {
      expect((await fetch(size.source_url)).status).toBe(200)
    }
  })

  it('refuses to edit or regenerate types the image editor can’t handle (415)', async () => {
    const list = await rest(
      'GET',
      '/wp/v2/media?per_page=100&_fields=id,mime_type',
    )
    const video = list.json.find((entry: Json) =>
      entry.mime_type.startsWith('video/'),
    )
    if (!video) return
    const edit = await operation(video.id, 'edit', {
      ops: [{ op: 'flipH' }],
      applyTo: 'all',
    })
    expect(edit.status).toBe(415)
    expect(edit.json).toMatchObject({
      code: 'wpu_unsupported_type',
      data: { mime: video.mime_type },
    })
    const regenerate = await plugin('POST', `/media/${video.id}/regenerate`, {
      body: {},
    })
    expect(regenerate.status).toBe(415)
  })

  describe('replace', () => {
    it('swaps the file under the same URL and rebuilds the sizes', async () => {
      const target = await jpegCopy('p2-replace.jpg')
      const replacement = await download(
        (await jpegCopy('p2-replace-source.jpg', 400)).media_details.sizes
          .medium.source_url,
      )
      const reply = await replaceWith(
        target.id,
        'anything.jpg',
        replacement,
        'image/jpeg',
      )
      expect(reply.status).toBe(200)
      PluginImageOpResponseSchema.parse(reply.json)
      expect(reply.json).toMatchObject({
        urlChanged: false,
        edited: false,
        undoable: false,
        ...dimensions(replacement),
      })
      const after = await media(target.id)
      expect(after.source_url).toBe(target.source_url)
      expect(sha256(await download(target.source_url))).toBe(
        sha256(replacement),
      )
    })

    it('keeps a -scaled URL when the new image is under the threshold', async () => {
      const big = await bigJpeg()
      if (!big) return
      const target = await upload('p2-replace-scaled.jpg', big, 'image/jpeg')
      expect(target.source_url).toMatch(/-scaled\.jpg$/)
      const small = await download(
        (await jpegCopy('p2-replace-small.jpg')).source_url,
      )
      const reply = await replaceWith(
        target.id,
        'small.jpg',
        small,
        'image/jpeg',
      )
      expect(reply.status).toBe(200)
      expect(reply.json).toMatchObject({
        urlChanged: false,
        ...dimensions(small),
      })
      const after = await media(target.id)
      expect(after.source_url).toBe(target.source_url)
      expect(dimensions(await download(target.source_url))).toEqual(
        dimensions(small),
      )
      // No longer a scaled copy: the old unscaled original goes.
      expect(after.media_details.original_image).toBeUndefined()
    })

    it('scales an oversized replacement and keeps the URL of an unscaled item', async () => {
      const big = await bigJpeg()
      if (!big) return
      const target = await jpegCopy('p2-replace-grow.jpg')
      const reply = await replaceWith(target.id, 'big.jpg', big, 'image/jpeg')
      expect(reply.status).toBe(200)
      expect(Math.max(reply.json.width, reply.json.height)).toBe(2560)
      const after = await media(target.id)
      expect(after.source_url).toBe(target.source_url)
      expect(after.media_details.original_image).toBeTruthy()
    })

    it('refuses another MIME type with 415 wpu_mime_mismatch', async () => {
      const reply = await replaceWith(
        item.id,
        'other.png',
        makePng(20, 20),
        'image/png',
      )
      expect(reply.status).toBe(415)
      expect(reply.json).toMatchObject({
        code: 'wpu_mime_mismatch',
        data: { mime: 'image/png', expected: 'image/jpeg' },
      })
    })

    it('needs a file (400) and a current expectedModified (409)', async () => {
      const form = new FormData()
      form.append('expectedModified', await modifiedAt(item.id))
      const noFile = await plugin('POST', `/media/${item.id}/replace`, { form })
      expect(noFile.status).toBe(400)
      expect(noFile.json.code).toBe('wpu_invalid_param')
      const stale = await replaceWith(
        item.id,
        'x.jpg',
        originalBytes,
        'image/jpeg',
        '2000-01-01T00:00:00Z',
      )
      expect(stale.status).toBe(409)
      expect(stale.json.code).toBe('wpu_stale')
    })
  })

  describe.skipIf(author === null)('as the Author', () => {
    it('can’t edit another user’s image (403) but can edit their own', async () => {
      const others = await operation(
        item.id,
        'edit',
        { ops: [{ op: 'flipH' }], applyTo: 'all' },
        author as Credentials,
      )
      expect(others.status).toBe(403)
      expect(others.json.code).toBe('wpu_forbidden')
      const own = await upload(
        'p2-author-edit.png',
        makePng(120, 80),
        'image/png',
        author as Credentials,
      )
      const reply = await operation(
        own.id,
        'edit',
        { ops: [{ op: 'rotate', angle: 90 }], applyTo: 'all' },
        author as Credentials,
      )
      expect(reply.status).toBe(200)
      expect(reply.json).toMatchObject({ width: 80, height: 120 })
      expect(dimensions(await download(own.source_url))).toEqual({
        width: 80,
        height: 120,
      })
    })
  })

  it('fills the wpu field keys P2 provides, once P1’s field is loaded', async () => {
    await operation(item.id, 'edit', { ops: [{ op: 'flipV' }], applyTo: 'all' })
    const reply = await rest('GET', `/wp/v2/media/${item.id}?_fields=id,wpu`)
    const field = reply.json.wpu
    if (field === undefined) return // P1's wpu field isn't on this branch yet.
    expect(field).toMatchObject({
      edited: true,
      undoable: true,
      restorable: true,
      sizesPending: false,
    })
    expect(typeof field.editedAt).toBe('string')
    await operation(item.id, 'restore')
  })

  it('reports no pending sizes after editing a -scaled item below a size its original allows', async () => {
    // A 2560 px `-scaled` item cropped to 2000 px: core still measures the unscaled original,
    // for which `2048x2048` is possible, but the edited file is too small for it.
    // (Core never scales PNGs, so a generated image can't stand in for the seed's JPEG.)
    const big = await bigJpeg()
    if (!big) return
    const target = await upload('p2-edit-scaled.jpg', big, 'image/jpeg')
    expect(target.media_details.original_image).toBeTruthy()
    const { width, height } = target.media_details
    const factor = 2000 / Math.max(width, height)
    const crop = {
      op: 'crop',
      x: 0,
      y: 0,
      width: Math.round(width * factor),
      height: Math.round(height * factor),
    }
    const edited = await operation(target.id, 'edit', {
      ops: [crop],
      applyTo: 'all',
    })
    expect(edited.status, JSON.stringify(edited.json)).toBe(200)
    expect(Math.max(edited.json.width, edited.json.height)).toBe(2000)

    const reply = await rest('GET', `/wp/v2/media/${target.id}?_fields=id,wpu`)
    const field = reply.json.wpu
    if (field === undefined) return // P1's wpu field isn't on this branch yet.
    expect(field).toMatchObject({
      edited: true,
      undoable: true,
      restorable: true,
      sizesPending: false,
    })
  })
})
