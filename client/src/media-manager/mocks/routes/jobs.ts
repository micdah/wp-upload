// Routes that start or read jobs: image operations (202 + jobId), regenerate,
// jobs, upload, upload/jobs, cancelling an upload, and the duplicate check.
// server-api.md §7.12, 7.13, 7.15.

import { HttpResponse } from 'msw'
import { LIMITS } from '../../../../../shared/library-api'
import * as S from '../../../../../shared/library-api.schema'
import { fakeError, invalidRequest } from '../fake/errors'
import type { UploadInput } from '../fake/library'
import { sniffDimensions } from '../fake/sniff'
import { apiError, idParam, jobIdsParam, json, readBody } from '../respond'
import { libraryRoute } from './define'

const accepted = (jobId: string) =>
  json(S.JobAcceptedSchema, { jobId }, { status: 202 })

/** Reads a multipart `file` into what the fake library needs. */
async function readFile(
  form: FormData,
  maxBytes: number,
): Promise<UploadInput> {
  const file = form.get('file')
  if (!(file instanceof File)) {
    throw fakeError(400, 'upload_error', 'No file was sent.')
  }
  if (file.size > maxBytes) {
    throw fakeError(
      413,
      'file_too_large',
      'The file is larger than the site allows.',
    )
  }
  const head = new Uint8Array(await file.slice(0, 64 * 1024).arrayBuffer())
  const { width, height } = file.type.startsWith('image/')
    ? sniffDimensions(head)
    : { width: 0, height: 0 }
  return {
    name: file.name || 'upload',
    type: file.type || 'application/octet-stream',
    size: file.size,
    blob: file,
    width,
    height,
  }
}

async function readForm(request: Request): Promise<FormData> {
  try {
    return await request.formData()
  } catch {
    throw fakeError(
      400,
      'upload_error',
      'The upload is not valid multipart data.',
    )
  }
}

export const jobRoutes = [
  libraryRoute({
    method: 'post',
    path: 'items/regenerate',
    feature: 'image-regenerate',
    write: true,
    handle: async ({ library, request }) => {
      const { ids } = await readBody(request, S.RegenerateRequestSchema)
      return accepted(library.startRegenerate(ids))
    },
  }),

  libraryRoute({
    method: 'post',
    path: 'items/:id/edit',
    feature: 'image-edit',
    write: true,
    handle: async ({ library, request, params }) => {
      const id = idParam(params.id)
      const edit = await readBody(request, S.EditRequestSchema)
      return accepted(library.startEdit(id, edit))
    },
  }),

  libraryRoute({
    method: 'post',
    path: 'items/:id/edit/undo',
    feature: 'image-edit',
    write: true,
    handle: async ({ library, request, params }) => {
      const id = idParam(params.id)
      const { expectedModified } = await readBody(
        request,
        S.ExpectedModifiedSchema,
      )
      return accepted(library.startUndo(id, expectedModified))
    },
  }),

  libraryRoute({
    method: 'post',
    path: 'items/:id/restore',
    feature: 'image-edit',
    write: true,
    handle: async ({ library, request, params }) => {
      const id = idParam(params.id)
      const { expectedModified } = await readBody(
        request,
        S.ExpectedModifiedSchema,
      )
      return accepted(library.startRestore(id, expectedModified))
    },
  }),

  libraryRoute({
    method: 'post',
    path: 'items/:id/replace',
    feature: 'image-replace',
    write: true,
    handle: async ({ library, request, params }) => {
      const id = idParam(params.id)
      const form = await readForm(request)
      const file = await readFile(form, library.config.upload.maxBytes)
      const expectedModified = form.get('expectedModified')
      const valid = S.ExpectedModifiedSchema.safeParse({ expectedModified })
      if (!valid.success) {
        throw invalidRequest('expectedModified')
      }
      return accepted(
        library.startReplace(id, file, valid.data.expectedModified),
      )
    },
  }),

  libraryRoute({
    method: 'get',
    path: 'jobs',
    query: ['ids'],
    handle: ({ library, search }) =>
      json(S.JobsResponseSchema, {
        jobs: library.jobLookups(jobIdsParam(search, LIMITS.jobIds), false),
      }),
  }),

  libraryRoute({
    method: 'post',
    path: 'upload',
    write: true,
    handle: async ({ library, request }) => {
      const form = await readForm(request)
      const file = await readFile(form, library.config.upload.maxBytes)
      const rawFolder = form.get('folder')
      let folder = 0
      if (typeof rawFolder === 'string' && rawFolder !== '') {
        if (!/^(0|[1-9][0-9]*)$/.test(rawFolder)) {
          throw invalidRequest('folder')
        }
        folder = Number(rawFolder)
      }
      return accepted(library.startUpload(file, folder))
    },
  }),

  libraryRoute({
    method: 'get',
    path: 'upload/jobs',
    query: ['ids'],
    handle: ({ library, search }) =>
      json(S.JobsResponseSchema, {
        jobs: library.jobLookups(jobIdsParam(search, LIMITS.jobIds), true),
      }),
  }),

  libraryRoute({
    method: 'delete',
    path: 'upload/jobs/:id',
    write: true,
    handle: ({ library, params }) => {
      const id = Array.isArray(params.id) ? params.id[0] : params.id
      if (typeof id !== 'string') {
        return apiError(404, 'job_not_found', 'Unknown upload.')
      }
      library.cancelUpload(id)
      return new HttpResponse(null, { status: 204 })
    },
  }),

  libraryRoute({
    method: 'get',
    path: 'upload/check',
    query: ['filename'],
    handle: ({ library, search }) => {
      const filename = search.get('filename') ?? ''
      if (filename.length < 1 || filename.length > 255) {
        throw invalidRequest('filename')
      }
      return json(S.UploadCheckResponseSchema, library.uploadCheck(filename))
    },
  }),
]
