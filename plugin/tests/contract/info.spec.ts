// GET /info (plugin-api.md §3).
import { afterAll, describe, expect, it } from 'vitest'
import { PluginIdentitySchema } from '../../../shared/library-api.schema.ts'
import { PLUGIN_FEATURES } from '../../../shared/library-api.ts'
import { anonymous, editor, PLUGIN } from './support/http.ts'
import { apiAtLeast, expectError, info, parse } from './support/library.ts'
import {
  asAuthor,
  authorAvailable,
  resetVariant,
  SKIP_REASON,
  setVariant,
  variantsAvailable,
} from './support/variants.ts'

describe('GET /info', () => {
  it('identifies the plugin first, then describes the site', async () => {
    const reply = await editor.get(`${PLUGIN}/info`)
    expect(reply.status).toBe(200)
    expect(Object.keys(reply.body).slice(0, 4)).toEqual([
      'plugin',
      'version',
      'api',
      'features',
    ])
    const body = await info()
    expect(body.plugin).toBe('wp-upload-companion')
    expect(apiAtLeast(body.api, '1.0')).toBe(true)
    expect(body.version).toMatch(/^1\.0\.0/)
    expect(['plugin', 'mu-plugin']).toContain(body.install)
    expect(body.wpVersion).toMatch(/^[0-9]+\.[0-9]+/)
  })

  it('lists P1 features, in PLUGIN_FEATURES order, without unknown names', async () => {
    const { features } = await info()
    for (const feature of ['collection', 'facets', 'folders', 'maintenance']) {
      expect(features).toContain(feature)
    }
    const known: readonly string[] = PLUGIN_FEATURES
    expect(features.every((feature) => known.includes(feature))).toBe(true)
    const positions = features.map((feature) => known.indexOf(feature))
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
  })

  it('describes the Editor app user', async () => {
    const { user } = await info()
    expect(user.roles).toContain('editor')
    expect(user.caps).toEqual({
      uploadFiles: true,
      editPosts: true,
      editOthersPosts: true,
      deletePosts: true,
      deleteOthersPosts: true,
      manageOptions: false,
    })
  })

  it('reports FileBird Lite as active, not Pro, shared tree', async () => {
    const { filebird } = await info()
    expect(filebird).toEqual({
      active: true,
      version: '6.5.9',
      pro: false,
      perUser: false,
    })
  })

  it('reports upload limits, image sizes, the image editor, index and rev', async () => {
    const body = await info()
    expect(body.upload.maxBytes).toBeGreaterThan(0)
    const jpeg = body.upload.mimes.find((mime) => mime.mime === 'image/jpeg')
    expect(jpeg?.extensions).toEqual(expect.arrayContaining(['jpg', 'jpeg']))
    expect(body.imageSizes.map((size) => size.name)).toEqual(
      expect.arrayContaining(['thumbnail', 'medium', 'large']),
    )
    expect(body.imageEditor.mimes).toContain('image/jpeg')
    expect(body.imageEditor.bigImageThreshold).toBe(2560)
    expect(body.index.media.state).toBe('ready')
    expect(body.index.media.done).toBe(body.index.media.total)
    expect(body.index.media.total).toBeGreaterThan(0)
    expect(body.rev).toMatch(/^[0-9]+$/)
  })

  it('answers 403 wpu_forbidden with identification, never 401, without upload_files', async () => {
    const reply = await anonymous.get(`${PLUGIN}/info`)
    expectError(reply, 403, 'wpu_forbidden')
    parse(PluginIdentitySchema.omit({ features: true }), reply.body.data)
    expect(reply.body.data.plugin).toBe('wp-upload-companion')
    expect(apiAtLeast(reply.body.data.api, '1.0')).toBe(true)
    expect(reply.headers.get('www-authenticate')).toBeNull()
  })

  it.skipIf(!authorAvailable)('describes an Author', async () => {
    await asAuthor(async (author) => {
      const { user } = await info(author)
      expect(user.roles).toContain('author')
      expect(user.caps.uploadFiles).toBe(true)
      expect(user.caps.editOthersPosts).toBe(false)
      expect(user.caps.deleteOthersPosts).toBe(false)
    })
  })
})

describe.skipIf(!variantsAvailable)(
  `GET /info with FileBird variants (${SKIP_REASON})`,
  () => {
    afterAll(() => resetVariant())

    it('reports FileBird installed but inactive', async () => {
      setVariant({ filebird: 'off' })
      const { filebird } = await info()
      expect(filebird).toEqual({
        active: false,
        version: '6.5.9',
        pro: false,
        perUser: false,
      })
    })

    it('reports per-user mode', async () => {
      setVariant({ filebird: 'on', peruser: 'on' })
      const { filebird } = await info()
      expect(filebird?.perUser).toBe(true)
    })

    it('reports the Trash when MEDIA_TRASH is on', async () => {
      setVariant({ peruser: 'off', trash: 'on' })
      const { trash } = await info()
      expect(trash.enabled).toBe(true)
      expect(trash.days).toBeGreaterThan(0)
    })
  },
)
