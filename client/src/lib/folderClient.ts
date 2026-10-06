import type { UploadClientError } from './uploadClient'

export interface FolderNode {
  id: number
  name: string
  children: FolderNode[]
}

// The folder new uploads get filed into, as captured when they're dropped.
export interface SelectedFolder {
  id: number
  name: string
}

async function parseJson<T>(res: Response): Promise<T> {
  let body: unknown
  try {
    body = await res.json()
  } catch {
    body = null
  }
  if (!res.ok) {
    const error = body as Partial<UploadClientError> | null
    throw {
      code: error?.code ?? 'invalid_response',
      message: error?.message ?? `Server responded with HTTP ${res.status}.`,
    } satisfies UploadClientError
  }
  return body as T
}

async function request<T>(input: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(input, init)
  } catch {
    throw {
      code: 'network_error',
      message: 'Network error contacting the local server.',
    } satisfies UploadClientError
  }
  return parseJson<T>(res)
}

export async function fetchFolders(): Promise<FolderNode[]> {
  const { folders } = await request<{ folders: FolderNode[] }>('/api/folders')
  return folders
}

export function createFolder(
  name: string,
  parentId: number,
): Promise<{ id: number }> {
  return request<{ id: number }>('/api/folders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, parentId }),
  })
}
