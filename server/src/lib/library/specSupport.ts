// Helpers for the library specs only (never imported by runtime code): fake
// WordPress answers for `wpAxios.request`, in the shapes axios produces.

import {
  AxiosError,
  AxiosHeaders,
  type AxiosRequestConfig,
  type AxiosResponse,
} from 'axios'
import express from 'express'
import { vi } from 'vitest'
import { pluginInfo } from '../../../../shared/fixtures/index.ts'
import type { LibraryItemFull } from '../../../../shared/library-api.ts'
import type { WpuField } from '../../../../shared/plugin-api.ts'
import { wpAxios } from '../../config/wpClient.ts'
import { errorHandler } from '../../middleware/errorHandler.ts'
import {
  maintenanceIdle,
  resetBootstrapForTests,
} from '../../routes/library/bootstrap.ts'
import { libraryRouter } from '../../routes/library/index.ts'
import { resetCacheForTests } from './cache.ts'
import type { WpMedia, WpMediaDetails, WpMediaSize } from './normalise/items.ts'
import { resetPluginClientForTests } from './pluginClient.ts'

/** A successful axios response with this JSON body. */
export function okResponse<T>(data: T, status = 200): AxiosResponse<T> {
  return {
    data,
    status,
    statusText: 'OK',
    headers: {},
    config: { headers: new AxiosHeaders() },
  }
}

/** The error axios throws when WordPress answered with a non-2xx status. */
export function httpError(
  status: number,
  data: unknown,
  headers: Record<string, string> = {},
): AxiosError {
  const config = { headers: new AxiosHeaders() }
  const response: AxiosResponse = {
    data,
    status,
    statusText: '',
    headers,
    config,
  }
  return new AxiosError(
    `Request failed with status code ${status}`,
    status >= 500 ? 'ERR_BAD_RESPONSE' : 'ERR_BAD_REQUEST',
    config,
    {},
    response,
  )
}

/** A WordPress REST error (`WP_Error` serialised by core). */
export function wpErrorResponse(
  status: number,
  code: string,
  message = `Upstream ${code}`,
  data: Record<string, unknown> = {},
): AxiosError {
  return httpError(status, { code, message, data: { status, ...data } })
}

/** The error axios throws when no response arrived (DNS, refused, reset). */
export function networkError(code = 'ECONNREFUSED'): AxiosError {
  return new AxiosError(`connect ${code}`, code, {
    headers: new AxiosHeaders(),
  })
}

/** The error axios throws on its own timeout. */
export function timeoutError(): AxiosError {
  return new AxiosError('timeout of 30000ms exceeded', 'ECONNABORTED', {
    headers: new AxiosHeaders(),
  })
}

export interface RecordedCall {
  method: string
  url: string
  params: Record<string, unknown>
  data: unknown
  headers: Record<string, unknown>
  timeout: number | undefined
}

/** What a `wpAxios.request` spy was called with, simplified for asserts. */
export function recordedCall(config: AxiosRequestConfig): RecordedCall {
  return {
    method: String(config.method ?? 'GET').toUpperCase(),
    url: String(config.url),
    params: (config.params ?? {}) as Record<string, unknown>,
    data: config.data,
    headers: (config.headers ?? {}) as Record<string, unknown>,
    timeout: config.timeout,
  }
}

/** Route key for a fake WordPress: `GET /wp-json/wp-upload/v1/info`. */
export function routeKey(config: AxiosRequestConfig): string {
  const call = recordedCall(config)
  return `${call.method} ${call.url}`
}

// ---------------------------------------------------------------------------
// A fake WordPress for route specs
// ---------------------------------------------------------------------------

/** Answers one route: return the JSON body, or throw an axios error. */
export type FakeHandler = (call: RecordedCall) => unknown

/**
 * Routes `wpAxios.request` to handlers keyed `METHOD /path` (e.g.
 * `GET /wp-json/wp-upload/v1/rev`). Unknown routes answer core's 404
 * `rest_no_route`. Returns the spy, so specs can count calls.
 */
export function fakeWordPress(routes: Record<string, FakeHandler>) {
  return vi.spyOn(wpAxios, 'request').mockImplementation(async (config) => {
    const call = recordedCall(config)
    const handler = routes[`${call.method} ${call.url}`]
    if (!handler) {
      throw wpErrorResponse(404, 'rest_no_route', 'No route was found.')
    }
    return okResponse(await handler(call))
  })
}

/**
 * The plugin's `/info` and `/rev` with the fixtures' values, plus
 * `overrides`: what most route specs need for the guards to pass.
 */
export function fakeLibrary(overrides: Record<string, FakeHandler> = {}) {
  return fakeWordPress({
    [plugin('GET', '/info')]: () => pluginInfo,
    [plugin('GET', '/rev')]: () => ({
      rev: pluginInfo.rev,
      index: pluginInfo.index,
    }),
    [plugin('POST', '/maintenance/step')]: () => pluginMaintenanceDone,
    ...overrides,
  })
}

const pluginMaintenanceDone = {
  rev: pluginInfo.rev,
  locked: false,
  did: { media: 0, usage: 0, folders: 0 },
  more: false,
  index: pluginInfo.index,
}

/**
 * An app with `libraryRouter` at the root, behind the app's own error
 * handler and 404, as app.ts mounts it under /api/library.
 */
export function libraryApp() {
  const app = express()
  app.use(libraryRouter)
  app.use((_req, res) => {
    res.status(404).json({ code: 'not_found', message: 'no route' })
  })
  app.use(errorHandler)
  return app
}

/** Clears every library module's state (call in afterEach). */
export async function resetLibrary(): Promise<void> {
  await maintenanceIdle()
  resetCacheForTests()
  resetBootstrapForTests()
  resetPluginClientForTests()
}

/** Plugin route key: `plugin('GET', '/rev')`. */
export function plugin(method: string, route: string): string {
  return `${method} /wp-json/wp-upload/v1${route}`
}

/** Calls of one route recorded by a fakeWordPress spy. */
export function callsTo(
  spy: { mock: { calls: unknown[][] } },
  key: string,
): RecordedCall[] {
  return spy.mock.calls
    .map((args) => recordedCall(args[0] as AxiosRequestConfig))
    .filter((call) => `${call.method} ${call.url}` === key)
}

// ---------------------------------------------------------------------------
// WordPress media built from the fixtures
// ---------------------------------------------------------------------------

const REST_BASES: Record<string, string> = { post: 'posts', page: 'pages' }

function basename(url: string): string {
  return url.split('/').pop() ?? ''
}

function shutterSeconds(shutter: string | null): string {
  if (!shutter) return '0'
  if (shutter.endsWith('s')) return shutter.slice(0, -1)
  const [, denominator] = shutter.split('/')
  return String(1 / Number(denominator))
}

/**
 * The `wpu` field the plugin would send for a fixture item (the inverse of
 * the normaliser).
 */
export function wpuFor(item: LibraryItemFull): WpuField {
  return {
    kind: item.kind,
    width: item.width,
    height: item.height,
    filesize: item.filesize,
    folder: item.folder,
    perms: item.perms,
    trashedAt: item.trash?.trashedAt ?? null,
    duration: item.duration,
    pages: item.pages,
    poster: item.poster,
    original: item.original,
    raw: {
      title: item.title,
      caption: item.caption,
      description: item.description,
    },
    author: item.author,
    edited: item.edited,
    editedAt: item.editedAt,
    undoable: item.undoable,
    restorable: item.restorable,
    sizesPending: item.sizesPending,
    usageCount: item.usageCount,
  }
}

/**
 * What core's `GET /wp/v2/media?context=view` returns for a fixture item,
 * as faithfully as the fixtures allow:
 * - `media_details.sizes` holds the generated sizes plus the `full` entry
 *   REST adds (no `filesize`, the item's MIME type), only when there are
 *   generated sizes;
 * - images carry `image_meta` with WordPress's string values;
 * - video and audio carry getID3's fields;
 * - `link` is the file URL (attachment pages disabled), `post` the parent.
 */
export function wpMediaFor(item: LibraryItemFull): WpMedia {
  const generated = item.sizes.filter((size) => size.name !== 'full')
  const fullSize = item.sizes.find((size) => size.name === 'full')
  const sizes: Record<string, WpMediaSize> = {}
  for (const size of generated) {
    sizes[size.name] = {
      file: basename(size.url),
      width: size.width,
      height: size.height,
      ...(size.filesize === null ? {} : { filesize: size.filesize }),
      mime_type: size.mime,
      source_url: size.url,
    }
  }
  if (generated.length > 0 && fullSize) {
    sizes.full = {
      file: basename(fullSize.url),
      width: fullSize.width,
      height: fullSize.height,
      mime_type: item.mime,
      source_url: fullSize.url,
    }
  }

  let details: WpMediaDetails = { sizes }
  if (item.kind === 'image') {
    const exif = item.exif
    details = {
      width: item.width,
      height: item.height,
      file: basename(item.url),
      ...(item.filesize === null ? {} : { filesize: item.filesize }),
      sizes,
      image_meta: {
        aperture: String(exif?.aperture ?? 0),
        credit: exif?.credit ?? '',
        camera: exif?.camera ?? '',
        caption: '',
        created_timestamp: exif?.takenAt
          ? String(Date.parse(exif.takenAt) / 1000)
          : '0',
        copyright: exif?.copyright ?? '',
        focal_length: String(exif?.focalLength ?? 0),
        iso: String(exif?.iso ?? 0),
        shutter_speed: shutterSeconds(exif?.shutter ?? null),
        title: '',
        orientation: '0',
        keywords: exif?.keywords ?? [],
        ...(exif?.lens ? { lens: exif.lens } : {}),
      },
    }
  } else if (item.kind === 'video' || item.kind === 'audio') {
    details = {
      ...(item.filesize === null ? {} : { filesize: item.filesize }),
      length: item.duration ?? 0,
      fileformat: item.media?.format ?? undefined,
      codec: item.media?.codec ?? undefined,
      bitrate: item.media?.bitrate ?? undefined,
      audio: {
        sample_rate: item.media?.sampleRate ?? undefined,
        channels: item.media?.channels ?? undefined,
      },
      ...(item.kind === 'video'
        ? { width: item.width, height: item.height }
        : {}),
      sizes,
    }
  }

  const parent = item.attachedTo
  return {
    id: item.id,
    date_gmt: item.uploadedAt.replace(/Z$/, ''),
    modified_gmt: item.modifiedAt.replace(/Z$/, ''),
    alt_text: item.alt,
    author: item.authorId,
    mime_type: item.mime,
    source_url: item.url,
    filename: item.filename,
    link: item.links.view ?? item.url,
    post: parent?.postId ?? 0,
    media_details: details,
    wpu: wpuFor(item),
    _links: parent
      ? {
          'wp:attached-to': [
            {
              embeddable: true,
              post_type: parent.postType,
              href: `https://example.com/wp-json/wp/v2/${REST_BASES[parent.postType] ?? parent.postType}/${parent.postId}`,
            },
          ],
        }
      : {},
  }
}
