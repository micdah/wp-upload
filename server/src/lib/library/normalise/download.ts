import type { DownloadVariant } from '../../../../../shared/library-api.ts'
import type { WpMedia } from './items.ts'

// An item → the file `items/:id/download` streams and the name the browser
// saves it under (server-api.md §7.16).

export interface DownloadSource {
  /** the file URL WordPress reported */
  url: string
  /** the name to save it as */
  filename: string
  mime: string
}

/** The last path segment of a URL, percent-decoded. */
export function urlBasename(url: string): string {
  let pathname: string
  try {
    pathname = new URL(url).pathname
  } catch {
    pathname = url
  }
  const segment = pathname.split('/').pop() ?? ''
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

/**
 * Which file to send: `file` is what `url` points to (saved under its own
 * basename, so a `-scaled` file keeps that name); `original` is the
 * untouched upload when WordPress scaled or rotated it, else the same as
 * `file`.
 */
export function downloadSource(
  media: WpMedia,
  variant: DownloadVariant,
): DownloadSource {
  const original = media.wpu?.original
  if (variant === 'original' && original?.url) {
    return {
      url: original.url,
      filename: original.filename || urlBasename(original.url),
      mime: media.mime_type,
    }
  }
  return {
    url: media.source_url,
    filename: urlBasename(media.source_url) || media.filename || 'download',
    mime: media.mime_type,
  }
}

/**
 * `Content-Disposition: attachment` with an ASCII fallback name and the
 * real name as RFC 5987 `filename*` (for non-ASCII names).
 */
export function contentDisposition(filename: string): string {
  const clean =
    // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point
    filename.replace(/[\x00-\x1f\x7f"\\/]/g, '').trim() || 'download'
  const ascii = clean.replace(/[^\x20-\x7e]/g, '_')
  const encoded = encodeURIComponent(clean).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  )
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`
}
