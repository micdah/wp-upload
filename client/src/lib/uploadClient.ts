export interface UploadClientError {
  code: string
  message: string
}

export interface UploadResult {
  id: number
  title: string
  sourceUrl: string
  mimeType: string
}

export interface UploadOptions {
  onProgress?: (percent: number) => void
  signal?: AbortSignal
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
      `/api/media/check?filename=${encodeURIComponent(filename)}`,
    )
    if (!res.ok) return { duplicate: false, matches: [] }
    return (await res.json()) as DuplicateCheckResult
  } catch {
    return { duplicate: false, matches: [] }
  }
}

// Wraps XMLHttpRequest (not fetch) because it reliably exposes upload
// progress events for the browser -> local backend leg.
export function uploadFile(
  file: File,
  { onProgress, signal }: UploadOptions = {},
): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    const formData = new FormData()
    formData.append('file', file)

    xhr.open('POST', '/api/media')

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(Math.round((event.loaded / event.total) * 100))
      }
    }

    xhr.onload = () => {
      let body: UploadResult | UploadClientError
      try {
        body = JSON.parse(xhr.responseText)
      } catch {
        body = {
          code: 'invalid_response',
          message: 'Server returned an unreadable response.',
        }
      }

      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(body as UploadResult)
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
