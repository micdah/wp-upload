// Fixture data for tests and mocks, consistent with the prototype's sample
// data (docs/media-manager/design/prototype/data/*.json): a 20-item subset,
// the same folder tree, users and posts. Imported only by tests and mocks.
// Keep fixtures mutually consistent (ids, counts, folders) when editing.

import type {
  Bootstrap,
  BundledPlugin,
  PluginStatus,
  SiteInfo,
  WpUser,
} from '../library-api.ts'

const rev = '1795867200000'
const features = [
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
  'usage-visual-portfolio',
]
const required = { major: 1, minMinor: 0 }

export const editorUser = {
  id: 2,
  name: 'Anna Berg',
  roles: ['editor'],
  caps: {
    uploadFiles: true,
    editPosts: true,
    editOthersPosts: true,
    deletePosts: true,
    deleteOthersPosts: true,
    manageOptions: false,
  },
} satisfies WpUser

export const authorUser = {
  id: 3,
  name: 'Jonas Holm',
  roles: ['author'],
  caps: {
    uploadFiles: true,
    editPosts: true,
    editOthersPosts: false,
    deletePosts: true,
    deleteOthersPosts: false,
    manageOptions: false,
  },
} satisfies WpUser

/** The site as an Editor sees it: FileBird Lite, trash off, index ready. */
export const siteInfo = {
  user: editorUser,
  filebird: { active: true, version: '6.5.9', pro: false, perUser: false },
  trash: { enabled: false, days: 30 },
  upload: {
    maxBytes: 67_108_864,
    mimes: [
      { extensions: ['jpg', 'jpeg', 'jpe'], mime: 'image/jpeg' },
      { extensions: ['png'], mime: 'image/png' },
      { extensions: ['gif'], mime: 'image/gif' },
      { extensions: ['webp'], mime: 'image/webp' },
      { extensions: ['avif'], mime: 'image/avif' },
      { extensions: ['heic'], mime: 'image/heic' },
      { extensions: ['mp4', 'm4v'], mime: 'video/mp4' },
      { extensions: ['webm'], mime: 'video/webm' },
      { extensions: ['mp3', 'm4a', 'm4b'], mime: 'audio/mpeg' },
      { extensions: ['pdf'], mime: 'application/pdf' },
      { extensions: ['zip'], mime: 'application/zip' },
    ],
  },
  imageSizes: [
    { name: 'thumbnail', width: 150, height: 150, crop: true },
    { name: 'medium', width: 300, height: 300, crop: false },
    { name: 'medium_large', width: 768, height: 0, crop: false },
    { name: 'large', width: 1024, height: 1024, crop: false },
    { name: '1536x1536', width: 1536, height: 1536, crop: false },
    { name: '2048x2048', width: 2048, height: 2048, crop: false },
  ],
  imageEditor: {
    mimes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif'],
    bigImageThreshold: 2560,
  },
  index: {
    media: { state: 'ready', done: 20, total: 20 },
    usage: { state: 'ready', done: 8, total: 8 },
  },
} satisfies SiteInfo

const bundled = {
  version: '1.0.0',
  api: '1.0',
  features,
  changelog: [],
} satisfies BundledPlugin

const pluginOk = {
  state: 'ok',
  version: '1.0.0',
  api: '1.0',
  features,
  missingFeatures: [],
  required,
  bundled,
  message: null,
} satisfies PluginStatus

/** Everything fine: the app runs. */
export const bootstrapOk = {
  wp: { state: 'ok', message: null },
  plugin: pluginOk,
  site: siteInfo,
  rev,
} satisfies Bootstrap

/** The app user is an Author: others' media is read-only. */
export const bootstrapAuthor = {
  ...bootstrapOk,
  site: { ...siteInfo, user: authorUser },
} satisfies Bootstrap

/** MEDIA_TRASH is on: Trash view, undoable deletes. */
export const bootstrapTrash = {
  ...bootstrapOk,
  site: { ...siteInfo, trash: { enabled: true, days: 30 } },
} satisfies Bootstrap

/** FileBird Pro detected: folder colours and folder sort. */
export const bootstrapFileBirdPro = {
  ...bootstrapOk,
  site: {
    ...siteInfo,
    filebird: { active: true, version: '6.5.9', pro: true, perUser: false },
  },
} satisfies Bootstrap

/** FileBird per-user mode: folders are browse-only. */
export const bootstrapFileBirdPerUser = {
  ...bootstrapOk,
  site: {
    ...siteInfo,
    filebird: { active: true, version: '6.5.9', pro: false, perUser: true },
  },
} satisfies Bootstrap

/** No FileBird: no folder UI at all. */
export const bootstrapNoFileBird = {
  ...bootstrapOk,
  site: { ...siteInfo, filebird: null },
} satisfies Bootstrap

/** The plugin's index is still building (first install, or reactivated). */
export const bootstrapIndexing = {
  ...bootstrapOk,
  site: {
    ...siteInfo,
    index: {
      media: { state: 'building', done: 12, total: 20 },
      usage: { state: 'stale', done: 3, total: 8 },
    },
  },
} satisfies Bootstrap

/** No `wp-upload/v1` namespace: onboarding. */
export const bootstrapPluginMissing = {
  wp: { state: 'ok', message: null },
  plugin: {
    state: 'missing',
    version: null,
    api: null,
    features: [],
    missingFeatures: [],
    required,
    bundled,
    message: 'The companion plugin was not found on the WordPress site.',
  },
  site: null,
  rev: null,
} satisfies Bootstrap

/** The WordPress user lacks `upload_files` (e.g. a Contributor). */
export const bootstrapPluginForbidden = {
  wp: { state: 'ok', message: null },
  plugin: {
    state: 'forbidden',
    version: '1.0.0',
    api: '1.0',
    features: [],
    missingFeatures: [],
    required,
    bundled,
    message:
      'The WordPress user this app signs in as cannot upload files. It needs the Editor role.',
  },
  site: null,
  rev: null,
} satisfies Bootstrap

/** The installed plugin is older than this app supports: blocking update. */
export const bootstrapPluginOutdated = {
  wp: { state: 'ok', message: null },
  plugin: {
    state: 'outdated',
    version: '1.0.3',
    api: '1.0',
    features,
    missingFeatures: [],
    required: { major: 1, minMinor: 1 },
    bundled: {
      version: '1.1.0',
      api: '1.1',
      features,
      changelog: [
        {
          version: '1.1.0',
          date: '2026-11-20',
          changes: [
            'Fixes a permission check on folder assignment (security).',
            'Counts trashed items correctly in the Trash summary.',
          ],
        },
      ],
    },
    message:
      'The companion plugin is version 1.0.3; this app needs API 1.1 or newer.',
  },
  site: null,
  rev: null,
} satisfies Bootstrap

/** The plugin is a newer major than this app understands. */
export const bootstrapPluginTooNew = {
  wp: { state: 'ok', message: null },
  plugin: {
    state: 'too-new',
    version: '2.0.0',
    api: '2.0',
    features,
    missingFeatures: [],
    required,
    bundled,
    message:
      'The companion plugin (API 2.0) is newer than this app supports. Update the app.',
  },
  site: null,
  rev: null,
} satisfies Bootstrap

/** Compatible, but the bundled zip is newer: dismissible notice. */
export const bootstrapPluginUpdateAvailable = {
  wp: { state: 'ok', message: null },
  plugin: {
    state: 'update-available',
    version: '1.0.0',
    api: '1.0',
    features,
    missingFeatures: [],
    required,
    bundled: {
      version: '1.0.1',
      api: '1.0',
      features,
      changelog: [
        {
          version: '1.0.1',
          date: '2026-11-21',
          changes: ['Faster Uncategorized counts on large libraries.'],
        },
      ],
    },
    message: 'Version 1.0.1 of the companion plugin is available.',
  },
  site: siteInfo,
  rev,
} satisfies Bootstrap

/** WordPress can't be reached (network error, timeout or 5xx). */
export const bootstrapWpUnreachable = {
  wp: {
    state: 'unreachable',
    message: 'Could not reach WordPress (ECONNREFUSED).',
  },
  plugin: null,
  site: null,
  rev: null,
} satisfies Bootstrap

/** WordPress rejected the Application Password. */
export const bootstrapWpAuthFailed = {
  wp: {
    state: 'auth_failed',
    message: 'WordPress rejected the configured credentials.',
  },
  plugin: null,
  site: null,
  rev: null,
} satisfies Bootstrap

/** One bootstrap per `plugin.state`, plus the two WordPress failure states. */
export const bootstrapByPluginState = {
  ok: bootstrapOk,
  missing: bootstrapPluginMissing,
  forbidden: bootstrapPluginForbidden,
  outdated: bootstrapPluginOutdated,
  'too-new': bootstrapPluginTooNew,
  'update-available': bootstrapPluginUpdateAvailable,
} satisfies Record<NonNullable<Bootstrap['plugin']>['state'], Bootstrap>
