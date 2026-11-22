// Fixture data for tests and mocks, consistent with the prototype's sample
// data (docs/media-manager/design/prototype/data/*.json): a 20-item subset,
// the same folder tree, users and posts. Imported only by tests and mocks.
// Keep fixtures mutually consistent (ids, counts, folders) when editing.

import type {
  ApiError,
  BatchResponse,
  DeleteResponse,
  EmptyTrashResponse,
  ItemPatchResponse,
  RestoreResponse,
  TrashSummary,
  UploadCheckResponse,
} from '../library-api.ts'

// Reads carry the base rev; each mutation carries the rev after its change.
const rev = '1795867200000'

/** `PATCH items/1001 {alt}`: alt was empty before. */
export const patchAlt = {
  rev: '1795867200001',
  id: 1001,
  previous: { alt: '' },
  item: {
    title: 'detail-oisin-conolly-330',
    alt: 'Close-up of a woven textile',
    caption: '',
    description: '',
    post: 202,
    modifiedAt: '2024-12-14T19:11:42Z',
  },
} satisfies ItemPatchResponse

/**
 * `items/batch {ids: [1002, 1010, 1000], set: {caption}}`: 1000 belongs to
 * someone else and the app user is an Author.
 */
export const batchCaption = {
  rev: '1795867200002',
  results: [
    {
      id: 1002,
      ok: true,
      previous: { caption: '' },
      item: {
        title: 'workspace-davide-ragusa-687',
        alt: '',
        caption: 'Summer party 2025',
        description: '',
        post: null,
        modifiedAt: '2026-11-22T12:00:04Z',
      },
    },
    {
      id: 1010,
      ok: true,
      previous: { caption: '' },
      item: {
        title: 'interior-antoine-beauvillain-478',
        alt: '',
        caption: 'Summer party 2025',
        description: '',
        post: null,
        modifiedAt: '2026-11-22T12:00:04Z',
      },
    },
    {
      id: 1000,
      ok: false,
      error: {
        code: 'wpu_forbidden',
        message: 'You can’t edit media uploaded by others.',
      },
    },
  ],
} satisfies BatchResponse

/** `items/delete {ids: [1017, 1026], mode: "trash"}`. */
export const deleteToTrash = {
  rev: '1795867200003',
  results: [
    {
      id: 1017,
      ok: true,
      trash: { trashedAt: '2026-11-22T12:00:03Z', daysLeft: 30 },
    },
    {
      id: 1026,
      ok: true,
      trash: { trashedAt: '2026-11-22T12:00:03Z', daysLeft: 30 },
    },
  ],
} satisfies DeleteResponse

/** `items/delete {ids: [1092, 999999], mode: "delete"}`. */
export const deletePermanently = {
  rev: '1795867200004',
  results: [
    { id: 1092, ok: true, trash: null },
    {
      id: 999999,
      ok: false,
      error: {
        code: 'wpu_not_found',
        message: 'Media item 999999 does not exist.',
      },
    },
  ],
} satisfies DeleteResponse

/** `GET trash` with the two trashed fixture items. */
export const trashSummary = {
  rev,
  enabled: true,
  days: 30,
  count: 2,
  bytes: 2_241_760,
} satisfies TrashSummary

/** `trash/restore {ids: [1017, 1026]}`. */
export const restoreFromTrash = {
  rev: '1795867200006',
  results: [
    { id: 1017, ok: true, folder: 12 },
    { id: 1026, ok: true, folder: 6 },
  ],
} satisfies RestoreResponse

/** `trash/empty`, first step of two. */
export const emptyTrashStep = {
  rev: '1795867200007',
  deleted: 1,
  remaining: 1,
  skipped: 0,
} satisfies EmptyTrashResponse

/** `upload/check?filename=logo-mark.svg`. */
export const uploadCheckDuplicate = {
  duplicate: true,
  matches: [
    {
      id: 1091,
      title: 'logo-mark',
      filename: 'logo-mark.svg',
      thumb: null,
    },
  ],
} satisfies UploadCheckResponse

/** Error bodies, one per mapping row of server-api.md "Error mapping". */
export const errors = {
  sessionLost: { code: 'unauthorized', message: 'Log in to continue.' },
  wpAuthFailed: {
    code: 'wp_auth_failed',
    message: 'WordPress rejected the configured credentials.',
    details: { upstreamStatus: 401, upstreamCode: 'incorrect_password' },
  },
  forbidden: {
    code: 'forbidden',
    message: 'Sorry, you are not allowed to edit this item.',
    details: { upstreamStatus: 403, upstreamCode: 'wpu_forbidden' },
  },
  stale: {
    code: 'wpu_stale',
    message:
      'The image changed since you started editing. Reload it and try again.',
    details: { modifiedAt: '2026-10-02T08:41:19Z' },
  },
  folderCycle: {
    code: 'wpu_folder_cycle',
    message: 'A folder can’t be moved into itself or one of its subfolders.',
  },
  invalidRequest: {
    code: 'invalid_request',
    message: 'ids: at most 100 ids per request.',
    details: { param: 'ids' },
  },
  pluginMissing: {
    code: 'plugin_missing',
    message: 'The companion plugin is not installed on the WordPress site.',
  },
  wpUnreachable: {
    code: 'wp_unreachable',
    message: 'Could not reach WordPress (ECONNREFUSED).',
  },
  wpTimeout: {
    code: 'wp_timeout',
    message: 'WordPress did not respond in time.',
  },
  wpError: {
    code: 'wp_error',
    message: 'WordPress failed with HTTP 500.',
    details: { upstreamStatus: 500, upstreamCode: 'internal_server_error' },
  },
} satisfies Record<string, ApiError>
