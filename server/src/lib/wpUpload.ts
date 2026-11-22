import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import { Readable } from 'node:stream'
import axios from 'axios'
import { invalidateConnection, wpAxios } from '../config/wpClient.ts'

export interface WpError {
  status: number
  code: string
  message: string
}

export function isWpError(e: unknown): e is WpError {
  return (
    typeof e === 'object' &&
    e !== null &&
    'status' in e &&
    'code' in e &&
    'message' in e
  )
}

export interface UploadResult {
  id: number
  title: string
  sourceUrl: string
  mimeType: string
}

export interface ExistingMedia {
  id: number
  title: string
  sourceUrl: string
}

// Approximates WordPress's sanitize_title_with_dashes() closely enough to
// find likely name collisions - it doesn't need to be byte-for-byte
// identical, since a missed match just means no warning is shown (see #28).
//
// Two things WP does that are easy to get wrong here (and did, in an earlier
// version of this function - it silently broke the duplicate check for any
// filename with an underscore, e.g. camera defaults like "IMG_1234.jpg"):
// underscores are kept as-is, not folded into a dash, and punctuation
// outside [a-z0-9 _-] is deleted outright rather than replaced with a dash
// (so "photo(1).jpg" becomes "photo1", not "photo-1").
export function filenameToSlug(filename: string): string {
  const base = filename.replace(/\.[^./]+$/, '')
  return base
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\./g, '-')
    .replace(/[^a-z0-9 _-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// Looks up existing media by the filename's likely slug. WordPress only
// dedupes filenames within the same year/month upload folder, so this is a
// best-effort "have I already uploaded this?" nudge, not a guarantee - see
// the investigation notes on issue #28.
//
// The slug WordPress gives an upload comes from its title, which (unless the
// image has an EXIF/IPTC title) is the uploaded filename minus its extension -
// see uploadToWordPress. Media uploaded before uploads were sent as multipart
// got titles from a mangled filename (e.g. "my20photo" for "my photo.jpg"),
// so it isn't matched here.
export async function findExistingMediaBySlug(
  filename: string,
): Promise<ExistingMedia[]> {
  const slug = filenameToSlug(filename)
  if (!slug) return []

  try {
    const { data } = await wpAxios.get('/wp-json/wp/v2/media', {
      params: { slug, _fields: 'id,title,source_url' },
    })
    return (Array.isArray(data) ? data : []).map((item) => ({
      id: item.id,
      title: item.title?.rendered ?? slug,
      sourceUrl: item.source_url,
    }))
  } catch (err) {
    throw normaliseWpError(err)
  }
}

// The quoted `filename` parameter of a multipart part header. The name is
// sent as raw UTF-8, which PHP passes through as-is - unlike a percent-encoded
// value, which PHP doesn't decode and WordPress's sanitize_file_name() then
// turns into e.g. "my20photo.jpg". PHP also ignores RFC 5987 `filename*=`.
//
// Removes what can't travel safely inside the quotes: `\` and `/` (PHP keeps
// only what follows the last one, as a basename), control characters (CR/LF
// would break the header), and `"` (PHP would accept it escaped as `\"`, but
// proxies and WAFs in front of WordPress may not). sanitize_file_name()
// deletes all of these anyway, so the stored filename is unaffected; only
// WordPress's default title (the filename minus its extension) loses them.
export function multipartFilename(name: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point
  const cleaned = name.replace(/["\\/\x00-\x1f\x7f]/g, '').trim()
  const extension = /\.[^.]+$/.exec(cleaned)?.[0] ?? ''
  if (cleaned === '' || cleaned === extension) return `upload${extension}`
  return cleaned
}

interface MultipartEnvelope {
  contentType: string
  head: Buffer
  tail: Buffer
}

// The bytes around the file in a single-part multipart/form-data body. The
// field must be named "file": WordPress reads $_FILES['file'].
function multipartEnvelope(file: Express.Multer.File): MultipartEnvelope {
  const boundary = `----wp-upload-${randomBytes(16).toString('hex')}`
  const partContentType = (file.mimetype || 'application/octet-stream').replace(
    /[\r\n]/g,
    '',
  )
  const head = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${multipartFilename(file.originalname)}"\r\n` +
      `Content-Type: ${partContentType}\r\n` +
      '\r\n',
    'utf8',
  )
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8')
  return {
    contentType: `multipart/form-data; boundary=${boundary}`,
    head,
    tail,
  }
}

// Read lazily, so only one chunk of the file is in memory at a time. If the
// request is aborted, destroying the body ends this generator, which closes
// the file stream.
async function* multipartBody(
  envelope: MultipartEnvelope,
  filePath: string,
): AsyncGenerator<Buffer> {
  yield envelope.head
  yield* fs.createReadStream(filePath)
  yield envelope.tail
}

// Streams a multer temp file to WordPress's media endpoint. Never buffers
// the whole file in memory. Throws a normalised { status, code, message }
// on any failure so the route handler can respond consistently.
//
// Sent as multipart/form-data rather than a raw body with a
// Content-Disposition header, for two reasons:
// - PHP spools a multipart file to a temp file, whereas WordPress reads a raw
//   body whole into a PHP string, so large files could exceed memory_limit.
// - WordPress takes a raw body's filename from Content-Disposition without
//   decoding it, so it can't carry spaces or non-ASCII names intact. In a
//   multipart part header it can (see multipartFilename), and WordPress then
//   also uses it, minus its extension, as the default title.
//
// The body is built by hand, rather than with the form-data package or native
// FormData/fetch, so it keeps wpAxios's WP_REQUEST_TIMEOUT_MS handling (fetch
// adds its own 5-minute limit on waiting for the response, which WordPress's
// thumbnail generation can exceed - see wpClient.ts), has an exact
// Content-Length (chunked request bodies don't work on every PHP host), and
// controls how the filename is quoted.
export async function uploadToWordPress(
  file: Express.Multer.File,
  options: { signal?: AbortSignal } = {},
): Promise<UploadResult> {
  const envelope = multipartEnvelope(file)
  const body = Readable.from(multipartBody(envelope, file.path))

  try {
    const { data } = await wpAxios.post('/wp-json/wp/v2/media', body, {
      headers: {
        'Content-Type': envelope.contentType,
        'Content-Length':
          envelope.head.length + file.size + envelope.tail.length,
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      // Without this, axios sends the request through follow-redirects, which
      // keeps a copy of the whole request body (up to maxBodyLength) so it can
      // replay it after a redirect - i.e. the entire file, in memory. A
      // redirect is reported as an unexpected response instead.
      maxRedirects: 0,
      signal: options.signal,
    })

    return {
      id: data.id,
      title: data.title?.rendered ?? file.originalname,
      sourceUrl: data.source_url,
      mimeType: data.mime_type,
    }
  } catch (err) {
    const wpError = normaliseWpError(err)
    if (wpError.status === 401 || wpError.status === 403) {
      invalidateConnection('WordPress rejected the configured credentials.')
    }
    throw wpError
  } finally {
    // axios pipes the body into the request, which doesn't destroy the body
    // when the request fails or is aborted part-way. Destroying it closes the
    // temp file; after a completed upload it's a no-op.
    body.destroy()
  }
}

// The HTTP status to answer the browser with for an upstream (WordPress or
// FileBird) error. A 401/403 from upstream means the server's own
// credentials were rejected, so it becomes a 502: under /api, a 401 must only
// ever mean "this browser's session is gone", which makes the client show
// its login form.
export function upstreamErrorStatus(status: number): number {
  if (!status || status === 401 || status === 403) return 502
  return status
}

export function normaliseWpError(err: unknown): WpError {
  if (axios.isAxiosError(err)) {
    if (err.code === 'ECONNABORTED') {
      return {
        status: 504,
        code: 'wp_timeout',
        message:
          'WordPress did not respond in time. The upload was aborted so it would not block others.',
      }
    }

    if (err.response) {
      const { status, data, headers } = err.response
      // Uploads don't follow redirects (see uploadToWordPress), so a redirect
      // means WP_URL doesn't point at where the site actually lives - e.g.
      // http:// for an https:// site.
      if (status >= 300 && status < 400) {
        const location = headers?.location
        return {
          status: 502,
          code: 'wp_redirect',
          message:
            `WordPress redirected the request (HTTP ${status}` +
            (location ? ` to ${location}` : '') +
            '). Set WP_URL to the address WordPress redirects to.',
        }
      }
      // WordPress normally returns JSON like { code, message }, but a WAF,
      // maintenance mode, or a PHP fatal can return an HTML page instead.
      if (data && typeof data === 'object' && data.message) {
        return { status, code: data.code || 'wp_error', message: data.message }
      }
      return {
        status,
        code: 'wp_unexpected_response',
        message:
          `WordPress returned an unexpected response (HTTP ${status}). ` +
          'This can happen if the host has a size limit, WAF rule, or maintenance mode enabled.',
      }
    }

    return {
      status: 502,
      code: 'wp_unreachable',
      message: `Could not reach WordPress (${err.code || err.message}).`,
    }
  }

  const message = err instanceof Error ? err.message : String(err)
  return {
    status: 502,
    code: 'wp_unreachable',
    message: `Could not reach WordPress (${message}).`,
  }
}
