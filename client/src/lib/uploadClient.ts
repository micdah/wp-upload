export interface UploadClientError {
  code: string
  message: string
}

export type FolderAssignment =
  | { id: number; assigned: true }
  | { id: number; assigned: false; message: string }

export interface UploadResult {
  id: number
  title: string
  sourceUrl: string
  mimeType: string
  // Only present when the upload asked to be filed into a FileBird folder.
  folder?: FolderAssignment
}

export interface StartedUpload {
  jobId: string
}

export type JobStatus =
  | { id: string; status: 'queued' | 'processing' }
  | { id: string; status: 'success'; result: UploadResult }
  | { id: string; status: 'error'; error: UploadClientError }
  | { id: string; status: 'not_found' }

export interface UploadOptions {
  onProgress?: (percent: number) => void
  signal?: AbortSignal
  folderId?: number
}

export interface ExistingMedia {
  id: number
  title: string
  sourceUrl: string
}

export interface DuplicateCheckResult {
  duplicate: boolean
  matches: ExistingMedia[]
}

// Best-effort pre-flight check - if it fails (network hiccup, WP down) we
// treat that the same as "no duplicate found" rather than blocking the
// upload on a check that's a nicety, not a requirement.
export async function checkDuplicate(
  filename: string,
): Promise<DuplicateCheckResult> {
  try {
    const res = await fetch(
      `api/media/check?filename=${encodeURIComponent(filename)}`,
    )
    if (!res.ok) return { duplicate: false, matches: [] }
    return (await res.json()) as DuplicateCheckResult
  } catch {
    return { duplicate: false, matches: [] }
  }
}

// Wraps XMLHttpRequest (not fetch) because it reliably exposes upload
// progress events for the browser -> local backend leg. Resolves as soon as
// the server has the file - the WordPress side then runs as a server-side
// job, followed via fetchJobStatuses().
export function uploadFile(
  file: File,
  { onProgress, signal, folderId }: UploadOptions = {},
): Promise<StartedUpload> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    const formData = new FormData()
    // Appended before the file so the field is parsed ahead of the upload.
    if (folderId) formData.append('folderId', String(folderId))
    formData.append('file', file)

    xhr.open('POST', 'api/media')

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(Math.round((event.loaded / event.total) * 100))
      }
    }

    xhr.onload = () => {
      let body: StartedUpload | UploadClientError
      try {
        body = JSON.parse(xhr.responseText)
      } catch {
        body = {
          code: 'invalid_response',
          message: 'Server returned an unreadable response.',
        }
      }

      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(body as StartedUpload)
      } else {
        reject(body)
      }
    }

    xhr.onerror = () =>
      reject({
        code: 'network_error',
        message: 'Network error contacting the local server.',
      })
    xhr.onabort = () =>
      reject({ code: 'aborted', message: 'Upload cancelled.' })

    if (signal) {
      signal.addEventListener('abort', () => xhr.abort())
    }

    xhr.send(formData)
  })
}

// One request for every job the client is following, so polling costs a
// single browser connection no matter how many uploads are processing.
// Throws on network/HTTP failure; callers treat that as "try again next tick".
export async function fetchJobStatuses(
  jobIds: string[],
  signal?: AbortSignal,
): Promise<JobStatus[]> {
  const res = await fetch(
    `api/media/jobs?ids=${jobIds.map(encodeURIComponent).join(',')}`,
    { signal },
  )
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const body = (await res.json()) as { jobs: JobStatus[] }
  return body.jobs
}

// Fire-and-forget: if this fails, the upload simply finishes in WordPress -
// the item is already gone from the UI either way.
export function cancelUploadJob(jobId: string): void {
  fetch(`api/media/jobs/${encodeURIComponent(jobId)}`, {
    method: 'DELETE',
  }).catch(() => {})
}
