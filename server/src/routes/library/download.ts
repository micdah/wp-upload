import { pipeline } from 'node:stream'
import axios, { type AxiosResponse } from 'axios'
import { Router } from 'express'
import {
  DOWNLOAD_VARIANTS,
  type DownloadVariant,
} from '../../../../shared/library-api.ts'
import { env } from '../../config/env.ts'
import {
  asyncRoute,
  invalidRequest,
  LibraryError,
  MESSAGES,
  notFound,
  pathId,
  queryParams,
} from '../../lib/library/errors.ts'
import {
  contentDisposition,
  downloadSource,
} from '../../lib/library/normalise/download.ts'
import { fetchMedia } from '../../lib/library/normalise/items.ts'

// GET items/:id/download (server-api.md §7.16): streams an item's file
// through the server, so the browser saves it under its real name (`<a
// download>` is ignored cross-origin). Never cached, never compressed.

export const downloadRouter = Router()

/**
 * The client for the files themselves. Separate from `wpAxios` on purpose:
 * the files are public URLs (often on a CDN), and the Application Password
 * must never travel to another host.
 */
export const fileAxios = axios.create()

/** Redirects a file URL may take (a CDN, http → https). */
export const MAX_FILE_REDIRECTS = 3

function isHttpUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

/** A failed file fetch: WordPress couldn't serve it (§7.16's errors). */
function fileFetchError(err: unknown): LibraryError {
  if (axios.isAxiosError(err)) {
    if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
      return new LibraryError(504, 'wp_timeout', MESSAGES.timeout)
    }
    if (err.response) {
      return new LibraryError(
        502,
        'wp_unreachable',
        `WordPress could not serve the file (HTTP ${err.response.status}).`,
        { upstreamStatus: err.response.status },
      )
    }
    return new LibraryError(
      502,
      'wp_unreachable',
      `Could not fetch the file from WordPress (${err.code || err.message}).`,
    )
  }
  if (err instanceof LibraryError) return err
  return new LibraryError(
    502,
    'wp_unreachable',
    'Could not fetch the file from WordPress.',
  )
}

/** Closes a stream (and its socket), if `stream` is one. */
function destroyStream(stream: unknown): void {
  const destroy = (stream as { destroy?: unknown } | null)?.destroy
  if (typeof destroy === 'function') destroy.call(stream)
}

/** Closes the body stream of a failed file fetch, if it has one. */
function destroyResponseStream(err: unknown): void {
  if (axios.isAxiosError(err)) destroyStream(err.response?.data)
}

downloadRouter.get(
  '/items/:id/download',
  asyncRoute(async (req, res) => {
    const id = pathId(req)
    const raw = queryParams(req, ['variant'])
    const variant = (raw.variant ?? 'file') as DownloadVariant
    if (!DOWNLOAD_VARIANTS.includes(variant)) {
      throw invalidRequest('variant', 'variant must be file or original.')
    }

    const [media] = await fetchMedia([id], 'tile')
    if (!media || media.id !== id) throw notFound()
    const source = downloadSource(media, variant)
    if (!isHttpUrl(source.url)) {
      throw new LibraryError(
        502,
        'wp_unexpected_response',
        'WordPress reported a file URL that is not http(s).',
      )
    }

    // Stop fetching when the browser goes away.
    const controller = new AbortController()
    res.on('close', () => controller.abort())

    let upstream: AxiosResponse<NodeJS.ReadableStream>
    try {
      upstream = await fileAxios.get(source.url, {
        responseType: 'stream',
        maxRedirects: MAX_FILE_REDIRECTS,
        beforeRedirect: (options: { protocol?: string }) => {
          if (options.protocol !== 'http:' && options.protocol !== 'https:') {
            throw new Error('Refusing a redirect away from http(s).')
          }
        },
        // Idle timeout: big files may take long, but must keep moving.
        timeout: env.wpRequestTimeoutMs,
        signal: controller.signal,
        // Bytes as they are: a server that compresses anyway gets its
        // Content-Encoding passed on with them.
        headers: { 'Accept-Encoding': 'identity' },
        decompress: false,
      })
    } catch (err) {
      // An error answer arrives as a stream too: close it, or its socket
      // stays open until the server times it out.
      destroyResponseStream(err)
      throw fileFetchError(err)
    }

    const headers: Record<string, string> = {
      'Content-Type': source.mime || 'application/octet-stream',
    }
    const length = upstream.headers['content-length']
    if (length !== undefined && /^[0-9]+$/.test(String(length))) {
      headers['Content-Length'] = String(length)
    }
    const encoding = upstream.headers['content-encoding']
    if (typeof encoding === 'string' && encoding !== 'identity') {
      headers['Content-Encoding'] = encoding
    }
    headers['Content-Disposition'] = contentDisposition(source.filename)
    headers['Cache-Control'] = 'private, no-store'
    headers['X-Content-Type-Options'] = 'nosniff'
    try {
      for (const [name, value] of Object.entries(headers)) {
        res.setHeader(name, value)
      }
    } catch (err) {
      // A header value Node refuses (e.g. a control character from
      // upstream): nothing was sent yet, so answer an error, without the
      // file's headers, and close the file stream.
      for (const name of Object.keys(headers)) res.removeHeader(name)
      destroyStream(upstream.data)
      throw new LibraryError(
        502,
        'wp_unexpected_response',
        `WordPress served the file with an invalid header (${err instanceof Error ? err.message : String(err)}).`,
      )
    }
    res.status(200)

    pipeline(upstream.data, res, (err) => {
      // Headers are out: all we can do is cut the connection.
      if (err && !res.destroyed) res.destroy(err)
    })
  }),
)
