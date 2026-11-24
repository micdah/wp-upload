// The upload transport against `api/library/upload*` (server-api.md §7.15).
// The upload feature (B2) owns the queue, the tray and polling policy; this
// is only the wire: send one file with progress, read job states, cancel,
// and the duplicate check.
//
// Uploads use XMLHttpRequest because fetch() can't report upload progress.
// A 401 triggers the app's session-expired dialog, like apiFetch.

import type {
  ApiError,
  JobAccepted,
  JobsResponse,
  UploadCheckResponse,
} from '../../../../../shared/library-api'
import { LIMITS } from '../../../../../shared/library-api'
import { apiFetch, notifyUnauthorized } from '../../../lib/api'

const BASE = 'api/library/upload'

/** A failed upload request: the HTTP status and the server's ApiError. */
export class UploadRequestError extends Error {
  readonly status: number
  readonly code: string
  readonly details: Record<string, unknown> | undefined
  constructor(
    status: number,
    body: Partial<ApiError> | null,
    fallback: string,
  ) {
    super(body?.message ?? fallback)
    this.name = 'UploadRequestError'
    this.status = status
    this.code = body?.code ?? (status === 0 ? 'network_error' : 'http_error')
    this.details = body?.details
  }
}

export interface UploadProgress {
  /** Bytes sent to our server so far. */
  loaded: number
  total: number
}

export interface StartUploadOptions {
  /** FileBird folder to file it in; 0 or absent = Uncategorized. */
  folder?: number | null
  onProgress?(progress: UploadProgress): void
  signal?: AbortSignal
}

function parseError(xhr: XMLHttpRequest): Partial<ApiError> | null {
  try {
    return JSON.parse(xhr.responseText) as ApiError
  } catch {
    return null
  }
}

/**
 * Sends one file. Resolves with the job id once the file is on the server
 * (202); WordPress processing continues as a job (poll fetchUploadJobs).
 */
export function startUpload(
  file: File,
  options: StartUploadOptions = {},
): Promise<JobAccepted> {
  const { signal } = options
  // Checked before opening: an XHR aborted before send() fires no abort
  // event, so it would never settle.
  if (signal?.aborted) {
    return Promise.reject(abortError())
  }
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    const form = new FormData()
    form.append('file', file, file.name)
    if (options.folder) {
      form.append('folder', String(options.folder))
    }
    const onAbort = () => xhr.abort()
    // Settled: a later abort of the (possibly long-lived) signal has nothing
    // left to cancel, and the listener must not keep the XHR alive.
    const detach = () => signal?.removeEventListener('abort', onAbort)
    xhr.open('POST', BASE)
    xhr.responseType = 'text'
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        options.onProgress?.({ loaded: event.loaded, total: event.total })
      }
    }
    xhr.onload = () => {
      detach()
      if (xhr.status === 401) {
        notifyUnauthorized()
      }
      if (xhr.status === 202 || xhr.status === 200) {
        try {
          resolve(JSON.parse(xhr.responseText) as JobAccepted)
        } catch {
          reject(
            new UploadRequestError(
              xhr.status,
              null,
              'The server sent an unreadable response.',
            ),
          )
        }
        return
      }
      reject(
        new UploadRequestError(
          xhr.status,
          parseError(xhr),
          `Upload failed (HTTP ${xhr.status}).`,
        ),
      )
    }
    xhr.onerror = () => {
      detach()
      reject(
        new UploadRequestError(
          0,
          null,
          'Could not reach the server. Check your connection.',
        ),
      )
    }
    xhr.onabort = () => {
      detach()
      reject(abortError())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    xhr.send(form)
  })
}

function abortError(): DOMException {
  return new DOMException('Upload cancelled', 'AbortError')
}

async function readJson<T>(response: Response, fallback: string): Promise<T> {
  if (!response.ok) {
    let body: Partial<ApiError> | null = null
    try {
      body = (await response.json()) as ApiError
    } catch {
      // Non-JSON error page.
    }
    throw new UploadRequestError(response.status, body, fallback)
  }
  return (await response.json()) as T
}

/** Job states for up to LIMITS.jobIds upload jobs (more are chunked). */
export async function fetchUploadJobs(
  ids: readonly string[],
  signal?: AbortSignal,
): Promise<JobsResponse> {
  const jobs: JobsResponse['jobs'] = []
  for (let start = 0; start < ids.length; start += LIMITS.jobIds) {
    const chunk = ids.slice(start, start + LIMITS.jobIds)
    const query = new URLSearchParams({ ids: chunk.join(',') })
    const response = await apiFetch(`${BASE}/jobs?${query}`, {
      signal,
      cache: 'no-store',
    })
    const body = await readJson<JobsResponse>(
      response,
      'Could not read the upload status.',
    )
    jobs.push(...body.jobs)
  }
  return { jobs }
}

/** Cancels a queued or running upload job. False when it had already finished. */
export async function cancelUploadJob(id: string): Promise<boolean> {
  const response = await apiFetch(`${BASE}/jobs/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
  if (response.status === 204) {
    return true
  }
  if (response.status === 404) {
    return false
  }
  await readJson<never>(response, 'Could not cancel the upload.')
  return false
}

/** Best-effort duplicate check before queueing a file. */
export async function checkDuplicate(
  filename: string,
  signal?: AbortSignal,
): Promise<UploadCheckResponse> {
  const query = new URLSearchParams({ filename })
  const response = await apiFetch(`${BASE}/check?${query}`, {
    signal,
    cache: 'no-store',
  })
  return readJson<UploadCheckResponse>(
    response,
    'Could not check for duplicates.',
  )
}
