// Fixture data for tests and mocks, consistent with the prototype's sample
// data (docs/media-manager/design/prototype/data/*.json): a 20-item subset,
// the same folder tree, users and posts. Imported only by tests and mocks.
// Keep fixtures mutually consistent (ids, counts, folders) when editing.
//
// These are *plugin* responses (`wp-upload/v1`), as the server's plugin
// client receives them.

import type {
  PluginDeleteResponse,
  PluginForbiddenData,
  PluginImageOpResponse,
  PluginInfo,
  PluginMaintenanceResponse,
  WpRestError,
  WpuField,
} from '../plugin-api.ts'
import { siteInfo } from './bootstrap.ts'

const rev = '1795867200000'

/** `GET /info` behind `bootstrapOk` (upload.maxBytes is WordPress's own). */
export const pluginInfo = {
  plugin: 'wp-upload-companion',
  version: '1.0.0',
  api: '1.0',
  features: [
    'collection',
    'facets',
    'media-batch',
    'trash',
    'usage',
    'image-edit',
    'image-regenerate',
    'image-replace',
    'folders',
    'folder-colors',
    'maintenance',
  ],
  install: 'plugin',
  wpVersion: '7.1.5',
  user: siteInfo.user,
  filebird: siteInfo.filebird,
  trash: siteInfo.trash,
  upload: siteInfo.upload,
  imageSizes: siteInfo.imageSizes,
  imageEditor: siteInfo.imageEditor,
  index: siteInfo.index,
  rev,
} satisfies PluginInfo

/** `GET /info` for a user without `upload_files`: 403, still identifiable. */
export const pluginInfoForbidden = {
  code: 'wpu_forbidden',
  message: 'You need the upload_files capability (Author role or higher).',
  data: {
    status: 403,
    plugin: 'wp-upload-companion',
    version: '1.0.0',
    api: '1.0',
  } satisfies PluginForbiddenData,
} satisfies WpRestError

/** Core's answer when the namespace isn't registered (plugin missing). */
export const restNoRoute = {
  code: 'rest_no_route',
  message: 'No route was found matching the URL and request method.',
  data: { status: 404 },
} satisfies WpRestError

/** The `wpu` field of item 1009 (edited in place once) in `/wp/v2/media`. */
export const wpuFieldEdited = {
  kind: 'image',
  width: 2560,
  height: 1707,
  filesize: 1604636,
  folder: 12,
  perms: { edit: true, delete: true },
  trashedAt: null,
  duration: null,
  pages: null,
  poster: null,
  original: {
    url: 'https://example.com/wp-content/uploads/2025/04/travel-fre-sonneveld-314.jpg',
    width: 4608,
    height: 3072,
    filename: 'travel-fre-sonneveld-314.jpg',
  },
  raw: { title: 'travel-fre-sonneveld-314', caption: '', description: '' },
  author: { id: 1, name: 'Site Admin' },
  edited: true,
  editedAt: '2026-10-02T08:41:19Z',
  undoable: true,
  restorable: true,
  sizesPending: false,
  usageCount: 3,
} satisfies WpuField

/** `POST /media/1009/restore`. */
export const pluginRestoreImage = {
  rev: '1795867200011',
  id: 1009,
  modifiedAt: '2026-11-22T11:58:02Z',
  width: 2560,
  height: 1707,
  mime: 'image/jpeg',
  sizesRegenerated: 6,
  urlChanged: false,
  edited: false,
  undoable: false,
  restorable: false,
} satisfies PluginImageOpResponse

/** `POST /media/delete` that ran out of its time budget after one item. */
export const pluginDeletePartial = {
  rev: '1795867200008',
  results: [{ id: 1004, ok: true, trash: null }],
  remaining: [1005],
} satisfies PluginDeleteResponse

/** `POST /maintenance/step` during the first backfill. */
export const pluginMaintenanceStep = {
  rev: '1795867200009',
  locked: false,
  did: { media: 8, usage: 0, folders: 0 },
  more: true,
  index: {
    media: { state: 'building', done: 12, total: 20 },
    usage: { state: 'building', done: 0, total: 8 },
  },
} satisfies PluginMaintenanceResponse
