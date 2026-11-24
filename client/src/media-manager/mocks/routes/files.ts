// File routes: `items/:id/download`, `plugin/download` (server-api.md §7.16,
// §7.17), and the mock's own media route that draws placeholder renditions
// (or serves an uploaded file back).

import { HttpResponse, http } from 'msw'
import { DOWNLOAD_VARIANTS } from '../../../../../shared/library-api'
import { mockContext, pluginStatus } from '../context'
import { fakeError, invalidRequest } from '../fake/errors'
import { hashString } from '../fake/random'
import type { FakeItem } from '../fake/types'
import { apiError, idParam } from '../respond'
import { libraryRoute } from './define'

/** An empty zip archive (end-of-central-directory record only). */
const EMPTY_ZIP = new Uint8Array([
  0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
])

function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '')
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}

function escapeXml(text: string): string {
  return text.replace(/[<>&"]/g, (char) => `&#${char.charCodeAt(0)};`)
}

const KIND_LABELS: Record<string, string> = {
  video: 'VIDEO',
  audio: 'AUDIO',
  document: 'DOC',
  archive: 'ZIP',
  other: 'FILE',
}

/** A soft gradient tile with the item's id: cheap, offline, deterministic. */
export function placeholderSvg(
  item: FakeItem,
  width: number,
  height: number,
): string {
  const hue = hashString(item.imageSeed) % 360
  const w = Math.max(1, Math.round(width))
  const h = Math.max(1, Math.round(height))
  const fontSize = Math.max(10, Math.round(Math.min(w, h) / 7))
  const label = KIND_LABELS[item.kind] ?? `#${item.id}`
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`,
    '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">',
    `<stop offset="0" stop-color="hsl(${hue} 55% 62%)"/>`,
    `<stop offset="1" stop-color="hsl(${(hue + 50) % 360} 60% 34%)"/>`,
    '</linearGradient></defs>',
    '<rect width="100%" height="100%" fill="url(#g)"/>',
    `<circle cx="${w * 0.78}" cy="${h * 0.28}" r="${Math.min(w, h) * 0.12}" fill="hsl(${hue} 80% 88% / 0.55)"/>`,
    `<path d="M0 ${h} L${w * 0.35} ${h * 0.55} L${w * 0.6} ${h * 0.8} L${w * 0.75} ${h * 0.65} L${w} ${h} Z" fill="hsl(${hue} 40% 20% / 0.45)"/>`,
    `<text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" font-family="system-ui, sans-serif" font-size="${fontSize}" fill="rgba(255,255,255,0.9)">${escapeXml(label)}</text>`,
    '</svg>',
  ].join('')
}

function sizeOf(
  item: FakeItem,
  size: string,
): { width: number; height: number } {
  if (size === 'original' && item.original) {
    return item.original
  }
  const match = /^(\d+)x(\d+)$/.exec(size)
  if (match) {
    return { width: Number(match[1]), height: Number(match[2]) }
  }
  return item.width > 0
    ? { width: item.width, height: item.height }
    : { width: 800, height: 600 }
}

export const fileRoutes = [
  libraryRoute({
    method: 'get',
    path: 'items/:id/download',
    query: ['variant'],
    handle: ({ library, params, search }) => {
      const variant = search.get('variant') || 'file'
      if (!(DOWNLOAD_VARIANTS as readonly string[]).includes(variant)) {
        throw invalidRequest('variant')
      }
      const file = library.mediaFile(idParam(params.id))
      if (!file) {
        throw fakeError(404, 'not_found', 'Not found.')
      }
      const { item, blob } = file
      const body: BodyInit =
        blob ??
        (item.kind === 'image' || item.kind === 'svg'
          ? placeholderSvg(item, item.width || 800, item.height || 600)
          : `Mock file for media item ${item.id} (${item.filename}).\n`)
      return new HttpResponse(body, {
        status: 200,
        headers: {
          'Content-Type': item.mime,
          'Content-Disposition': contentDisposition(item.filename),
          'Cache-Control': 'private, no-store',
        },
      })
    },
  }),

  libraryRoute({
    method: 'get',
    path: 'plugin/download',
    guard: 'files',
    handle: ({ mock }) => {
      const bundled = pluginStatus(mock)?.bundled ?? null
      if (!bundled) {
        return apiError(
          404,
          'plugin_not_bundled',
          'This app has no bundled plugin.',
        )
      }
      return new HttpResponse(EMPTY_ZIP, {
        status: 200,
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="wp-upload-companion-${bundled.version}.zip"`,
          ETag: `"${bundled.version}"`,
          'Cache-Control': 'private, max-age=0, must-revalidate',
        },
      })
    },
  }),

  // Renditions and files the fake's DTOs point at (fake/dto.ts).
  http.get('*/mock-media/:id/:size/:file', ({ params }) => {
    const id = Number(params.id)
    const file = mockContext().library.mediaFile(id)
    if (!file) {
      return new HttpResponse(null, { status: 404 })
    }
    if (file.blob) {
      return new HttpResponse(file.blob, {
        headers: {
          'Content-Type': file.item.mime,
          'Cache-Control': 'no-cache',
        },
      })
    }
    const { width, height } = sizeOf(file.item, String(params.size))
    return new HttpResponse(placeholderSvg(file.item, width, height), {
      headers: {
        'Content-Type': 'image/svg+xml',
        'Cache-Control': 'max-age=3600',
      },
    })
  }),
]
