import axios from 'axios'
import { filebirdAxios } from '../config/filebirdClient.ts'
import { normaliseWpError, type WpError } from './wpUpload.ts'

export interface FolderNode {
  id: number
  name: string
  children: FolderNode[]
}

interface RawFolder {
  id?: unknown
  text?: unknown
  children?: unknown
}

// FileBird returns ids as numbers from /folders but as strings elsewhere
// (e.g. /folder), so everything is coerced rather than trusted. Nodes without
// a usable positive id are dropped instead of failing the whole tree.
function mapFolders(raw: unknown): FolderNode[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item: RawFolder): FolderNode[] => {
    const id = Number(item?.id)
    if (!Number.isInteger(id) || id <= 0) return []
    return [
      {
        id,
        name: typeof item.text === 'string' ? item.text : `Folder ${id}`,
        children: mapFolders(item.children),
      },
    ]
  })
}

// FileBird wraps every response as { success, data } and can report a
// failure (e.g. a duplicate folder name) with HTTP 200 and success: false.
function unwrap(body: unknown): Record<string, unknown> {
  const response = (body ?? {}) as {
    success?: unknown
    data?: unknown
    message?: unknown
  }
  if (response.success !== true) {
    const message =
      typeof response.message === 'string' && response.message
        ? response.message
        : typeof response.data === 'string' && response.data
          ? response.data
          : 'FileBird reported an error.'
    throw { status: 502, code: 'filebird_error', message } satisfies WpError
  }
  return (response.data ?? {}) as Record<string, unknown>
}

export function normaliseFilebirdError(err: unknown): WpError {
  if (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    err.code === 'filebird_error'
  ) {
    return err as WpError
  }

  if (axios.isAxiosError(err) && err.response) {
    const { status, data } = err.response
    if (status === 401 || status === 403) {
      return {
        status: 502,
        code: 'filebird_unauthorized',
        message: 'FileBird rejected the configured API key (FILEBIRD_API_KEY).',
      }
    }
    if (status === 404 && data?.code === 'rest_no_route') {
      return {
        status: 502,
        code: 'filebird_unavailable',
        message:
          'The FileBird API was not found - is the FileBird plugin installed and active?',
      }
    }
  }

  return normaliseWpError(err)
}

export async function listFolders(): Promise<FolderNode[]> {
  try {
    const { data } = await filebirdAxios.get('/folders')
    return mapFolders(unwrap(data).folders)
  } catch (err) {
    throw normaliseFilebirdError(err)
  }
}

export async function createFolder(
  name: string,
  parentId: number,
): Promise<{ id: number }> {
  try {
    const { data } = await filebirdAxios.post('/folders', {
      name,
      parent_id: parentId,
    })
    const id = Number(unwrap(data).id)
    if (!Number.isInteger(id) || id <= 0) {
      throw {
        status: 502,
        code: 'filebird_error',
        message: 'FileBird did not return the new folder id.',
      } satisfies WpError
    }
    return { id }
  } catch (err) {
    throw normaliseFilebirdError(err)
  }
}

export async function assignToFolder(
  attachmentId: number,
  folderId: number,
): Promise<void> {
  try {
    const { data } = await filebirdAxios.post('/folder/set-attachment', {
      folder: folderId,
      ids: [attachmentId],
    })
    unwrap(data)
  } catch (err) {
    throw normaliseFilebirdError(err)
  }
}
