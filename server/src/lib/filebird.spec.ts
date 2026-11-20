import type { AxiosResponse } from 'axios'
import { describe, expect, it, vi } from 'vitest'
import { filebirdAxios } from '../config/filebirdClient.ts'
import {
  assignToFolder,
  createFolder,
  listFolders,
  normaliseFilebirdError,
} from './filebird.ts'

function ok(data: unknown) {
  return { data } as unknown as AxiosResponse
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

  it('falls back to normaliseWpError for anything else', () => {
    const result = normaliseFilebirdError({
      isAxiosError: true,
      code: 'ECONNABORTED',
    })

    expect(result.code).toBe('wp_timeout')
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

    it('throws a filebird_error when FileBird reports success: false', async () => {
      vi.spyOn(filebirdAxios, 'get').mockResolvedValue(
        ok({ success: false, message: 'Nope' }),
      )

      await expect(listFolders()).rejects.toEqual({
        status: 502,
        code: 'filebird_error',
        message: 'Nope',
      })
    })

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
    it('posts name and parent_id and returns the new id', async () => {
      vi.spyOn(filebirdAxios, 'post').mockResolvedValue(
        ok({ success: true, data: { id: '40' } }),
      )

      const result = await createFolder('Dogs', 1)

      expect(filebirdAxios.post).toHaveBeenCalledWith('/folders', {
        name: 'Dogs',
        parent_id: 1,
      })
      expect(result).toEqual({ id: 40 })
    })

    it('passes through a FileBird failure message (e.g. duplicate name)', async () => {
      vi.spyOn(filebirdAxios, 'post').mockResolvedValue(
        ok({ success: false, data: 'A folder with this name already exists.' }),
      )

      await expect(createFolder('Dogs', 0)).rejects.toEqual({
        status: 502,
        code: 'filebird_error',
        message: 'A folder with this name already exists.',
      })
    })

    it('throws when the response has no usable id', async () => {
      vi.spyOn(filebirdAxios, 'post').mockResolvedValue(
        ok({ success: true, data: {} }),
      )

      await expect(createFolder('Dogs', 0)).rejects.toMatchObject({
        code: 'filebird_error',
      })
    })
  })

  describe('assignToFolder', () => {
    it('posts the folder and attachment id', async () => {
      vi.spyOn(filebirdAxios, 'post').mockResolvedValue(ok({ success: true }))

      await assignToFolder(7, 40)

      expect(filebirdAxios.post).toHaveBeenCalledWith(
        '/folder/set-attachment',
        { folder: 40, ids: [7] },
      )
    })

    it('throws when FileBird reports success: false', async () => {
      vi.spyOn(filebirdAxios, 'post').mockResolvedValue(ok({ success: false }))

      await expect(assignToFolder(7, 40)).rejects.toEqual({
        status: 502,
        code: 'filebird_error',
        message: 'FileBird reported an error.',
      })
    })
  })
})
