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

// Wraps XMLHttpRequest (not fetch) because it reliably exposes upload
// progress events for the browser -> local backend leg.
export function uploadFile(
  file: File,
  { onProgress, signal }: UploadOptions = {},
): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    const formData = new FormData()
    formData.append("file", file)

    xhr.open("POST", "/api/media")

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
          code: "invalid_response",
          message: "Server returned an unreadable response.",
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
        code: "network_error",
        message: "Network error contacting the local server.",
      })
    xhr.onabort = () =>
      reject({ code: "aborted", message: "Upload cancelled." })

    if (signal) {
      signal.addEventListener("abort", () => xhr.abort())
    }

    xhr.send(formData)
  })
}
