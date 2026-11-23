// Fixture data for tests and mocks, consistent with the prototype's sample
// data (docs/media-manager/design/prototype/data/*.json): a 20-item subset,
// the same folder tree, users and posts. Imported only by tests and mocks.
// Keep fixtures mutually consistent (ids, counts, folders) when editing.

import type {
  ImageJob,
  JobLookup,
  JobNotFound,
  JobsResponse,
  RegenerateJob,
  UploadJob,
} from '../library-api.ts'

export const jobUploadQueued = {
  id: '6f1c2a4e-0c55-4f4f-9a49-6d2f8c1b0a01',
  kind: 'upload',
  state: 'queued',
  createdAt: '2026-11-22T11:59:58Z',
  updatedAt: '2026-11-22T11:59:58Z',
  progress: null,
  error: null,
  filename: 'harbour-at-dawn.jpg',
  result: null,
} satisfies UploadJob

export const jobUploadRunning = {
  id: '6f1c2a4e-0c55-4f4f-9a49-6d2f8c1b0a02',
  kind: 'upload',
  state: 'running',
  createdAt: '2026-11-22T11:59:50Z',
  updatedAt: '2026-11-22T11:59:57Z',
  progress: {
    done: 1572864,
    total: 4194304,
    unit: 'bytes',
  },
  error: null,
  filename: 'team-offsite.png',
  result: null,
} satisfies UploadJob

/** Every byte is sent; WordPress is generating sub-sizes. */
export const jobUploadProcessing = {
  id: '6f1c2a4e-0c55-4f4f-9a49-6d2f8c1b0a03',
  kind: 'upload',
  state: 'processing',
  createdAt: '2026-11-22T11:59:30Z',
  updatedAt: '2026-11-22T11:59:41Z',
  progress: {
    done: 2964080,
    total: 2964080,
    unit: 'bytes',
  },
  error: null,
  filename: 'portrait-philipp-henzler-411.png',
  result: null,
} satisfies UploadJob

export const jobUploadSucceeded = {
  id: '6f1c2a4e-0c55-4f4f-9a49-6d2f8c1b0a04',
  kind: 'upload',
  state: 'succeeded',
  createdAt: '2026-11-22T11:58:10Z',
  updatedAt: '2026-11-22T11:58:52Z',
  progress: {
    done: 2964080,
    total: 2964080,
    unit: 'bytes',
  },
  error: null,
  filename: 'portrait-philipp-henzler-411.png',
  result: {
    item: {
      id: 1029,
      view: 'tile',
      kind: 'image',
      mime: 'image/png',
      title: 'portrait-philipp-henzler-411',
      filename: 'portrait-philipp-henzler-411.png',
      width: 2560,
      height: 1207,
      filesize: 2964080,
      alt: 'Sample portrait photograph by Philipp Henzler',
      uploadedAt: '2026-11-22T11:58:40Z',
      modifiedAt: '2026-11-22T11:58:40Z',
      authorId: 3,
      folder: 15,
      url: 'https://example.com/wp-content/uploads/2026/11/portrait-philipp-henzler-411-scaled.png',
      thumb: {
        url: 'https://example.com/wp-content/uploads/2026/11/portrait-philipp-henzler-411-150x150.png',
        width: 150,
        height: 150,
      },
      srcset: [
        {
          url: 'https://example.com/wp-content/uploads/2026/11/portrait-philipp-henzler-411-300x141.png',
          width: 300,
          height: 141,
        },
        {
          url: 'https://example.com/wp-content/uploads/2026/11/portrait-philipp-henzler-411-768x362.png',
          width: 768,
          height: 362,
        },
        {
          url: 'https://example.com/wp-content/uploads/2026/11/portrait-philipp-henzler-411-1024x483.png',
          width: 1024,
          height: 483,
        },
        {
          url: 'https://example.com/wp-content/uploads/2026/11/portrait-philipp-henzler-411-1536x724.png',
          width: 1536,
          height: 724,
        },
        {
          url: 'https://example.com/wp-content/uploads/2026/11/portrait-philipp-henzler-411-2048x966.png',
          width: 2048,
          height: 966,
        },
        {
          url: 'https://example.com/wp-content/uploads/2026/11/portrait-philipp-henzler-411-scaled.png',
          width: 2560,
          height: 1207,
        },
      ],
      poster: null,
      duration: null,
      pages: null,
      sizesPending: true,
      perms: {
        edit: true,
        delete: true,
      },
      trash: null,
    },
    folder: {
      id: 15,
      assigned: true,
      message: null,
    },
  },
} satisfies UploadJob

export const jobEditFailedStale = {
  id: 'b3d9e0f2-7a1c-4c8e-8f43-2f6a9c3e1b05',
  kind: 'edit',
  state: 'failed',
  createdAt: '2026-11-22T11:57:00Z',
  updatedAt: '2026-11-22T11:57:01Z',
  progress: null,
  error: {
    code: 'wpu_stale',
    message:
      'The image changed since you started editing. Reload it and try again.',
    details: {
      modifiedAt: '2026-10-02T08:41:19Z',
    },
  },
  itemId: 1009,
  result: null,
} satisfies ImageJob

export const jobRestoreSucceeded = {
  id: 'b3d9e0f2-7a1c-4c8e-8f43-2f6a9c3e1b06',
  kind: 'restore',
  state: 'succeeded',
  createdAt: '2026-11-22T11:57:40Z',
  updatedAt: '2026-11-22T11:58:02Z',
  progress: null,
  error: null,
  itemId: 1009,
  result: {
    item: {
      id: 1009,
      view: 'full',
      kind: 'image',
      mime: 'image/jpeg',
      title: 'travel-fre-sonneveld-314',
      filename: 'travel-fre-sonneveld-314.jpg',
      width: 2560,
      height: 1707,
      filesize: 1604636,
      alt: 'Sample travel photograph by Fré Sonneveld',
      uploadedAt: '2025-04-08T08:53:55Z',
      modifiedAt: '2026-11-22T11:58:02Z',
      authorId: 1,
      folder: 12,
      url: 'https://example.com/wp-content/uploads/2025/04/travel-fre-sonneveld-314-scaled.jpg',
      thumb: {
        url: 'https://example.com/wp-content/uploads/2025/04/travel-fre-sonneveld-314-150x150.jpg',
        width: 150,
        height: 150,
      },
      srcset: [
        {
          url: 'https://example.com/wp-content/uploads/2025/04/travel-fre-sonneveld-314-300x200.jpg',
          width: 300,
          height: 200,
        },
        {
          url: 'https://example.com/wp-content/uploads/2025/04/travel-fre-sonneveld-314-768x512.jpg',
          width: 768,
          height: 512,
        },
        {
          url: 'https://example.com/wp-content/uploads/2025/04/travel-fre-sonneveld-314-1024x683.jpg',
          width: 1024,
          height: 683,
        },
        {
          url: 'https://example.com/wp-content/uploads/2025/04/travel-fre-sonneveld-314-1536x1024.jpg',
          width: 1536,
          height: 1024,
        },
        {
          url: 'https://example.com/wp-content/uploads/2025/04/travel-fre-sonneveld-314-2048x1366.jpg',
          width: 2048,
          height: 1366,
        },
        {
          url: 'https://example.com/wp-content/uploads/2025/04/travel-fre-sonneveld-314-scaled.jpg',
          width: 2560,
          height: 1707,
        },
      ],
      poster: null,
      duration: null,
      pages: null,
      sizesPending: false,
      perms: {
        edit: true,
        delete: true,
      },
      trash: null,
      caption: '',
      description: '',
      author: {
        id: 1,
        name: 'Site Admin',
      },
      attachedTo: {
        postId: 203,
        postType: 'page',
        postTypeLabel: 'Page',
        title: 'About us',
        status: 'publish',
        editUrl: 'https://example.com/wp-admin/post.php?post=203&action=edit',
        viewUrl: 'https://example.com/?p=203',
      },
      original: {
        url: 'https://example.com/wp-content/uploads/2025/04/travel-fre-sonneveld-314.jpg',
        width: 4608,
        height: 3072,
        filename: 'travel-fre-sonneveld-314.jpg',
      },
      sizes: [
        {
          name: 'thumbnail',
          url: 'https://example.com/wp-content/uploads/2025/04/travel-fre-sonneveld-314-150x150.jpg',
          width: 150,
          height: 150,
          mime: 'image/jpeg',
          filesize: 8262,
        },
        {
          name: 'medium',
          url: 'https://example.com/wp-content/uploads/2025/04/travel-fre-sonneveld-314-300x200.jpg',
          width: 300,
          height: 200,
          mime: 'image/jpeg',
          filesize: 22032,
        },
        {
          name: 'medium_large',
          url: 'https://example.com/wp-content/uploads/2025/04/travel-fre-sonneveld-314-768x512.jpg',
          width: 768,
          height: 512,
          mime: 'image/jpeg',
          filesize: 144389,
        },
        {
          name: 'large',
          url: 'https://example.com/wp-content/uploads/2025/04/travel-fre-sonneveld-314-1024x683.jpg',
          width: 1024,
          height: 683,
          mime: 'image/jpeg',
          filesize: 256817,
        },
        {
          name: '1536x1536',
          url: 'https://example.com/wp-content/uploads/2025/04/travel-fre-sonneveld-314-1536x1024.jpg',
          width: 1536,
          height: 1024,
          mime: 'image/jpeg',
          filesize: 577556,
        },
        {
          name: '2048x2048',
          url: 'https://example.com/wp-content/uploads/2025/04/travel-fre-sonneveld-314-2048x1366.jpg',
          width: 2048,
          height: 1366,
          mime: 'image/jpeg',
          filesize: 1027268,
        },
        {
          name: 'full',
          url: 'https://example.com/wp-content/uploads/2025/04/travel-fre-sonneveld-314-scaled.jpg',
          width: 2560,
          height: 1707,
          mime: 'image/jpeg',
          filesize: 1604636,
        },
      ],
      exif: {
        camera: 'iPhone 15 Pro',
        lens: 'Main camera 6.86mm f/1.78',
        focalLength: 85,
        aperture: 8,
        shutter: '1/1000',
        iso: 200,
        takenAt: '2025-04-06T05:43:26Z',
        credit: 'Fré Sonneveld',
        copyright: null,
        keywords: [],
      },
      media: null,
      edited: false,
      editedAt: null,
      undoable: false,
      restorable: false,
      usageCount: 3,
      links: {
        edit: 'https://example.com/wp-admin/post.php?post=1009&action=edit',
        view: null,
      },
    },
    sizesRegenerated: 6,
    urlChanged: false,
  },
} satisfies ImageJob

export const jobRegenerateRunning = {
  id: 'c41f7d08-93b2-4a7e-a0c4-5e8d1f2b3c07',
  kind: 'regenerate',
  state: 'running',
  createdAt: '2026-11-22T11:59:00Z',
  updatedAt: '2026-11-22T11:59:40Z',
  progress: {
    done: 2,
    total: 4,
    unit: 'items',
  },
  error: null,
  itemIds: [1000, 1002, 1003, 1004],
  result: null,
} satisfies RegenerateJob

export const jobRegenerateSucceeded = {
  id: 'c41f7d08-93b2-4a7e-a0c4-5e8d1f2b3c08',
  kind: 'regenerate',
  state: 'succeeded',
  createdAt: '2026-11-22T11:50:00Z',
  updatedAt: '2026-11-22T11:51:12Z',
  progress: {
    done: 2,
    total: 2,
    unit: 'items',
  },
  error: null,
  itemIds: [1000, 1091],
  result: {
    results: [
      {
        id: 1000,
        ok: true,
        sizesRegenerated: 6,
      },
      {
        id: 1091,
        ok: false,
        error: {
          code: 'wpu_unsupported_type',
          message: 'SVG files have no generated sizes.',
        },
      },
    ],
  },
} satisfies RegenerateJob

export const jobNotFound = {
  id: 'd0000000-0000-4000-8000-000000000009',
  state: 'not_found',
} satisfies JobNotFound

/** One job in each state, as `jobs?ids=…` returns them. */
export const jobsEveryState = {
  jobs: [
    jobUploadQueued,
    jobUploadRunning,
    jobUploadProcessing,
    jobUploadSucceeded,
    jobEditFailedStale,
    jobRegenerateRunning,
    jobNotFound,
  ] satisfies JobLookup[],
} satisfies JobsResponse
