import type { AxiosResponse } from 'axios'
import { describe, expect, it, vi } from 'vitest'
import { filebirdAxios } from '../config/filebirdClient.ts'
import {
  assignToFolder,
  createFolder,
  filebirdStoredName,
  listFolders,
  normaliseFilebirdError,
} from './filebird.ts'

function ok(data: unknown) {
  return { data } as unknown as AxiosResponse
}

// The shape FileBird 6.5.9's GET /folders returns for one node.
function rawFolder(id: number, text: string, children: unknown[] = []) {
  return { key: id, id, text, title: text, parent: 0, children }
}

function treeResponse(folders: unknown[]) {
  return ok({ success: true, data: { folders } })
}

describe.concurrent('normaliseFilebirdError', () => {
  it.each([401, 403])('maps HTTP %i to an API key error', (status) => {
    const result = normaliseFilebirdError({
      isAxiosError: true,
      response: { status, data: { code: 'rest_forbidden', message: 'No' } },
    })

    expect(result).toEqual({
      status: 502,
      code: 'filebird_unauthorized',
      message: expect.stringContaining('FILEBIRD_API_KEY'),
    })
  })

  it('maps a missing REST route to a plugin-not-active error', () => {
    const result = normaliseFilebirdError({
      isAxiosError: true,
      response: { status: 404, data: { code: 'rest_no_route', message: 'x' } },
    })

    expect(result.code).toBe('filebird_unavailable')
  })

  it('passes through an error this module raised itself', () => {
    const own = {
      status: 404,
      code: 'parent_folder_not_found',
      message: 'Gone.',
    }

    expect(normaliseFilebirdError(own)).toBe(own)
  })

  it('falls back to normaliseWpError for anything else', () => {
    const result = normaliseFilebirdError({
      isAxiosError: true,
      code: 'ECONNABORTED',
    })

    expect(result.code).toBe('wp_timeout')
  })
})

describe.concurrent('filebirdStoredName', () => {
  // Inputs and results observed against FileBird 6.5.9.
  it.each([
    ['==', ''],
    ['- -', ''],
    ['<b>=</b>', ''],
    ['=%41', ''],
    ['<b></b>', ''],
    ['  spaced   out  ', 'spaced out'],
    ['100%ab off', '100 off'],
    ['-Dogs', 'Dogs'],
    ['Cats', 'Cats'],
    ['Tom & Jerry', 'Tom & Jerry'],
    // wp_strip_all_tags drops <script>/<style> blocks with their content.
    ['<script>x</script>=', ''],
    ['=<style>a</style>', ''],
    // PHP's trim()/ltrim() strip NUL but keep non-ASCII spaces.
    ['=\u0000', ''],
    ['=\u0000=', ''],
    ['=\u00a0=', '\u00a0='],
  ])('maps %j to %j', (input, expected) => {
    expect(filebirdStoredName(input)).toBe(expected)
  })
})

// Plain describe: every test spies on the shared filebirdAxios instance.
describe('FileBird API calls', () => {
  describe('listFolders', () => {
    it('maps the folder tree, coercing ids and dropping unusable nodes', async () => {
      vi.spyOn(filebirdAxios, 'get').mockResolvedValue(
        ok({
          success: true,
          data: {
            folders: [
              {
                id: 1,
                text: 'Animals',
                count: 3,
                children: [
                  { id: '2', text: 'Cats', children: [] },
                  { id: 'nope', text: 'Broken' },
                ],
              },
              { id: 3, children: [] },
            ],
          },
        }),
      )

      const result = await listFolders()

      expect(filebirdAxios.get).toHaveBeenCalledWith('/folders')
      expect(result).toEqual([
        {
          id: 1,
          name: 'Animals',
          children: [{ id: 2, name: 'Cats', children: [] }],
        },
        { id: 3, name: 'Folder 3', children: [] },
      ])
    })

    it('decodes the HTML entities WordPress stores in folder names', async () => {
      vi.spyOn(filebirdAxios, 'get').mockResolvedValue(
        treeResponse([
          rawFolder(1, 'Tom &amp; Jerry', [rawFolder(2, 'a &gt; b')]),
          rawFolder(3, 'x &lt;3'),
          rawFolder(4, 'it&#039;s &#x27;quoted&#X27; &quot;here&quot;'),
          rawFolder(5, 'literal &amp;lt; stays encoded once'),
          rawFolder(6, 'café &eacute; &#0; &#xD800; &#99999999;'),
        ]),
      )

      const names = (await listFolders()).flatMap((folder) => [
        folder.name,
        ...folder.children.map((child) => child.name),
      ])

      expect(names).toEqual([
        'Tom & Jerry',
        'a > b',
        'x <3',
        `it's 'quoted' "here"`,
        'literal &lt; stays encoded once',
        'café &eacute; &#0; &#xD800; &#99999999;',
      ])
    })

    it.each([
      [
        'data.mess',
        { success: false, data: { mess: 'Validation failed' } },
        'Validation failed',
      ],
      [
        'data.message',
        { success: false, data: { message: 'Data message' } },
        'Data message',
      ],
      ['a top-level message', { success: false, message: 'Nope' }, 'Nope'],
      ['a string data', { success: false, data: 'Data text' }, 'Data text'],
      ['no message', { success: false }, 'FileBird reported an error.'],
      [
        'an empty data.mess',
        { success: false, data: { mess: '' } },
        'FileBird reported an error.',
      ],
      [
        'a non-string data.mess',
        { success: false, data: { mess: ['x'] } },
        'FileBird reported an error.',
      ],
    ])(
      'reports success: false with %s as a filebird_error',
      async (_label, body, message) => {
        vi.spyOn(filebirdAxios, 'get').mockResolvedValue(ok(body))

        await expect(listFolders()).rejects.toEqual({
          status: 502,
          code: 'filebird_error',
          message,
        })
      },
    )

    it('rethrows a normalised auth error', async () => {
      vi.spyOn(filebirdAxios, 'get').mockRejectedValue({
        isAxiosError: true,
        response: { status: 401, data: {} },
      })

      await expect(listFolders()).rejects.toMatchObject({
        code: 'filebird_unauthorized',
      })
    })
  })

  describe('createFolder', () => {
    function catsTree(lastSuffix: number) {
      const cats = [rawFolder(100, 'Cats')]
      for (let suffix = 1; suffix <= lastSuffix; suffix++) {
        cats.push(rawFolder(100 + suffix, `Cats (${suffix})`))
      }
      return cats
    }

    it('posts name and parent_id and returns the new id', async () => {
      vi.spyOn(filebirdAxios, 'get').mockResolvedValue(
        treeResponse([rawFolder(1, 'Animals')]),
      )
      vi.spyOn(filebirdAxios, 'post').mockResolvedValue(
        ok({ success: true, data: { id: '40' } }),
      )

      const result = await createFolder('Dogs', 1)

      expect(filebirdAxios.get).toHaveBeenCalledWith('/folders')
      expect(filebirdAxios.post).toHaveBeenCalledWith('/folders', {
        name: 'Dogs',
        parent_id: 1,
      })
      expect(result).toEqual({ id: 40 })
    })

    it('finds a nested parent folder', async () => {
      vi.spyOn(filebirdAxios, 'get').mockResolvedValue(
        treeResponse([
          rawFolder(1, 'Animals', [
            rawFolder(2, 'Pets', [rawFolder(3, 'Old')]),
          ]),
        ]),
      )
      vi.spyOn(filebirdAxios, 'post').mockResolvedValue(
        ok({ success: true, data: { id: 41 } }),
      )

      await expect(createFolder('Dogs', 3)).resolves.toEqual({ id: 41 })
    })

    it('rejects a parent that no longer exists without creating anything', async () => {
      vi.spyOn(filebirdAxios, 'get').mockResolvedValue(
        treeResponse([rawFolder(1, 'Animals')]),
      )
      vi.spyOn(filebirdAxios, 'post')

      await expect(createFolder('Dogs', 99999)).rejects.toEqual({
        status: 404,
        code: 'parent_folder_not_found',
        message: expect.stringContaining('refresh'),
      })
      expect(filebirdAxios.post).not.toHaveBeenCalled()
    })

    it('rejects a name FileBird can no longer make unique among top-level folders', async () => {
      vi.spyOn(filebirdAxios, 'get').mockResolvedValue(
        treeResponse(catsTree(15)),
      )
      vi.spyOn(filebirdAxios, 'post')

      await expect(createFolder('Cats', 0)).rejects.toEqual({
        status: 409,
        code: 'folder_name_exhausted',
        message: expect.stringContaining('"Cats"'),
      })
      expect(filebirdAxios.post).not.toHaveBeenCalled()
    })

    it('rejects an exhausted name inside a parent folder', async () => {
      vi.spyOn(filebirdAxios, 'get').mockResolvedValue(
        treeResponse([rawFolder(1, 'Animals', catsTree(15))]),
      )
      vi.spyOn(filebirdAxios, 'post')

      await expect(createFolder('Cats', 1)).rejects.toMatchObject({
        status: 409,
        code: 'folder_name_exhausted',
      })
      expect(filebirdAxios.post).not.toHaveBeenCalled()
    })

    // MySQL's usual collations make FileBird's duplicate lookup case- and
    // accent-insensitive.
    it.each(['cats', 'CATS', 'C\u00e0ts'])(
      'treats %j as the same exhausted name',
      async (name) => {
        vi.spyOn(filebirdAxios, 'get').mockResolvedValue(
          treeResponse(catsTree(15)),
        )
        vi.spyOn(filebirdAxios, 'post')

        await expect(createFolder(name, 0)).rejects.toMatchObject({
          code: 'folder_name_exhausted',
        })
        expect(filebirdAxios.post).not.toHaveBeenCalled()
      },
    )

    it('creates a name with a leading sigil, which FileBird never treats as a duplicate', async () => {
      vi.spyOn(filebirdAxios, 'get').mockResolvedValue(
        treeResponse(catsTree(15)),
      )
      vi.spyOn(filebirdAxios, 'post').mockResolvedValue(
        ok({ success: true, data: { id: 200 } }),
      )

      await expect(createFolder(' -Cats', 0)).resolves.toEqual({ id: 200 })
    })

    it('still creates a duplicate name while FileBird can rename it', async () => {
      vi.spyOn(filebirdAxios, 'get').mockResolvedValue(
        treeResponse([...catsTree(14), rawFolder(1, 'Animals', catsTree(15))]),
      )
      vi.spyOn(filebirdAxios, 'post').mockResolvedValue(
        ok({ success: true, data: { id: 116 } }),
      )

      await expect(createFolder('Cats', 0)).resolves.toEqual({ id: 116 })
    })

    it('passes through the FileBird failure message', async () => {
      vi.spyOn(filebirdAxios, 'get').mockResolvedValue(treeResponse([]))
      vi.spyOn(filebirdAxios, 'post').mockResolvedValue(
        ok({ success: false, data: { mess: 'Required fields are missing.' } }),
      )

      await expect(createFolder('<b></b>', 0)).rejects.toEqual({
        status: 502,
        code: 'filebird_error',
        message: 'Required fields are missing.',
      })
    })

    it('throws when FileBird reports a failed insert (id: null)', async () => {
      vi.spyOn(filebirdAxios, 'get').mockResolvedValue(treeResponse([]))
      vi.spyOn(filebirdAxios, 'post').mockResolvedValue(
        ok({ success: true, data: { id: null } }),
      )

      await expect(createFolder('Dogs', 0)).rejects.toEqual({
        status: 502,
        code: 'filebird_error',
        message: 'FileBird did not return the new folder id.',
      })
    })

    it('rethrows a normalised error from loading the tree', async () => {
      vi.spyOn(filebirdAxios, 'get').mockRejectedValue({
        isAxiosError: true,
        response: { status: 401, data: {} },
      })
      vi.spyOn(filebirdAxios, 'post')

      await expect(createFolder('Dogs', 0)).rejects.toMatchObject({
        code: 'filebird_unauthorized',
      })
      expect(filebirdAxios.post).not.toHaveBeenCalled()
    })
  })

  describe('assignToFolder', () => {
    function folderDetail(folder: unknown) {
      return ok({ success: true, data: { folder } })
    }

    it('checks the folder exists, then posts the folder and attachment id', async () => {
      vi.spyOn(filebirdAxios, 'get').mockResolvedValue(
        folderDetail({ id: '40', name: 'Dogs', parent: '0' }),
      )
      vi.spyOn(filebirdAxios, 'post').mockResolvedValue(ok({ success: true }))

      await assignToFolder(7, 40)

      expect(filebirdAxios.get).toHaveBeenCalledWith('/folder', {
        params: { folder_id: 40 },
      })
      expect(filebirdAxios.post).toHaveBeenCalledWith(
        '/folder/set-attachment',
        { folder: 40, ids: [7] },
      )
    })

    it('refuses to file into a folder that no longer exists', async () => {
      vi.spyOn(filebirdAxios, 'get').mockResolvedValue(folderDetail(null))
      vi.spyOn(filebirdAxios, 'post')

      await expect(assignToFolder(7, 99999)).rejects.toEqual({
        status: 404,
        code: 'filebird_folder_not_found',
        message: expect.stringContaining('no longer exists'),
      })
      expect(filebirdAxios.post).not.toHaveBeenCalled()
    })

    it('passes through the FileBird failure message', async () => {
      vi.spyOn(filebirdAxios, 'get').mockResolvedValue(
        folderDetail({ id: '40', name: 'Dogs', parent: '0' }),
      )
      vi.spyOn(filebirdAxios, 'post').mockResolvedValue(
        ok({ success: false, data: { mess: 'Validation failed' } }),
      )

      await expect(assignToFolder(7, 40)).rejects.toEqual({
        status: 502,
        code: 'filebird_error',
        message: 'Validation failed',
      })
    })

    it('passes through a FileBird failure from the folder lookup', async () => {
      vi.spyOn(filebirdAxios, 'get').mockResolvedValue(
        ok({ success: false, data: { mess: 'Lookup failed' } }),
      )
      vi.spyOn(filebirdAxios, 'post')

      await expect(assignToFolder(7, 40)).rejects.toEqual({
        status: 502,
        code: 'filebird_error',
        message: 'Lookup failed',
      })
      expect(filebirdAxios.post).not.toHaveBeenCalled()
    })

    it('rethrows a normalised error from the folder lookup', async () => {
      vi.spyOn(filebirdAxios, 'get').mockRejectedValue({
        isAxiosError: true,
        response: { status: 403, data: {} },
      })
      vi.spyOn(filebirdAxios, 'post')

      await expect(assignToFolder(7, 40)).rejects.toMatchObject({
        code: 'filebird_unauthorized',
      })
      expect(filebirdAxios.post).not.toHaveBeenCalled()
    })
  })
})
