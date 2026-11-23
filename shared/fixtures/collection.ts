// Fixture data for tests and mocks, consistent with the prototype's sample
// data (docs/media-manager/design/prototype/data/*.json): a 20-item subset,
// the same folder tree, users and posts. Imported only by tests and mocks.
// Keep fixtures mutually consistent (ids, counts, folders) when editing.

import type { CollectionResponse, Facets } from '../library-api.ts'

export const fixtureRev = '1795867200000'

/** `collection` with every default: all live items, newest first. */
export const collectionAll = {
  rev: '1795867200000',
  query: {
    folder: 'all',
    q: null,
    type: null,
    alt: null,
    size: null,
    orient: null,
    month: null,
    sort: 'date-desc',
  },
  total: 18,
  rows: [
    1029, 2560, 1207, 0, 1090, 0, 0, 3, 1092, 0, 0, 5, 1091, 512, 512, 1, 1088,
    1240, 1754, 4, 1021, 2560, 1700, 0, 1086, 1920, 1080, 2, 1016, 2513, 1670,
    0, 1013, 1706, 2560, 0, 1010, 2560, 1706, 0, 1009, 2560, 1707, 0, 1087,
    1080, 1920, 2, 1005, 1706, 2560, 0, 1004, 1500, 2000, 0, 1003, 1572, 1179,
    0, 1002, 2560, 1700, 0, 1001, 2560, 1707, 0, 1000, 2560, 1706, 0,
  ],
  indexComplete: true,
} satisfies CollectionResponse

/** `collection?folder=0&alt=missing`. */
export const collectionUncategorizedMissingAlt = {
  rev: '1795867200000',
  query: {
    folder: 0,
    q: null,
    type: null,
    alt: 'missing',
    size: null,
    orient: null,
    month: null,
    sort: 'date-desc',
  },
  total: 1,
  rows: [1001, 2560, 1707, 0],
  indexComplete: true,
} satisfies CollectionResponse

/** `collection?folder=trash`: newest trash first; other filters ignored. */
export const collectionTrash = {
  rev: '1795867200000',
  query: {
    folder: 'trash',
    q: null,
    type: null,
    alt: null,
    size: null,
    orient: null,
    month: null,
    sort: 'date-desc',
  },
  total: 2,
  rows: [1026, 2560, 1707, 0, 1017, 2560, 1270, 0],
  indexComplete: true,
} satisfies CollectionResponse

/** `facets` with every default (view and folder scope are the same). */
export const facetsAll = {
  rev: '1795867200000',
  query: {
    folder: 'all',
    q: null,
    type: null,
    alt: null,
    size: null,
    orient: null,
    month: null,
    sort: 'date-desc',
  },
  view: {
    total: 18,
    bytes: 126891208,
    types: {
      image: 13,
      video: 2,
      audio: 1,
      document: 2,
    },
    missingAlt: 4,
    unused: 10,
    editable: 18,
  },
  folder: {
    total: 18,
    bytes: 126891208,
    types: {
      image: 13,
      video: 2,
      audio: 1,
      document: 2,
    },
    missingAlt: 4,
    unused: 10,
    editable: 18,
  },
  months: [
    {
      month: '2026-11',
      count: 1,
    },
    {
      month: '2026-06',
      count: 1,
    },
    {
      month: '2026-05',
      count: 1,
    },
    {
      month: '2025-12',
      count: 1,
    },
    {
      month: '2025-10',
      count: 1,
    },
    {
      month: '2025-07',
      count: 1,
    },
    {
      month: '2025-06',
      count: 2,
    },
    {
      month: '2025-05',
      count: 1,
    },
    {
      month: '2025-04',
      count: 2,
    },
    {
      month: '2025-02',
      count: 1,
    },
    {
      month: '2025-01',
      count: 3,
    },
    {
      month: '2024-12',
      count: 3,
    },
  ],
  indexComplete: true,
  usageComplete: true,
} satisfies Facets

/** `facets?folder=0&alt=missing`: view is filtered, folder is not. */
export const facetsUncategorizedMissingAlt = {
  rev: '1795867200000',
  query: {
    folder: 0,
    q: null,
    type: null,
    alt: 'missing',
    size: null,
    orient: null,
    month: null,
    sort: 'date-desc',
  },
  view: {
    total: 1,
    bytes: 4543667,
    types: {
      image: 1,
      video: 0,
      audio: 0,
      document: 0,
    },
    missingAlt: 1,
    unused: 1,
    editable: 1,
  },
  folder: {
    total: 2,
    bytes: 5874709,
    types: {
      image: 2,
      video: 0,
      audio: 0,
      document: 0,
    },
    missingAlt: 1,
    unused: 2,
    editable: 2,
  },
  months: [
    {
      month: '2025-01',
      count: 1,
    },
    {
      month: '2024-12',
      count: 1,
    },
  ],
  indexComplete: true,
  usageComplete: true,
} satisfies Facets
