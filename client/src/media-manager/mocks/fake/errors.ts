// Errors the fake library throws; the route wrapper turns them into the
// contract's `ApiError` responses (server-api.md §2).

import type { ApiError } from '../../../../../shared/library-api.ts'

export class FakeError extends Error {
  readonly status: number
  readonly body: ApiError

  constructor(status: number, body: ApiError) {
    super(body.message)
    this.status = status
    this.body = body
  }
}

export function fakeError(
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>,
): FakeError {
  return new FakeError(
    status,
    details === undefined ? { code, message } : { code, message, details },
  )
}

/** 400 `invalid_request` naming the offending parameter or field. */
export function invalidRequest(param: string, message?: string): FakeError {
  return fakeError(
    400,
    'invalid_request',
    message ?? `Invalid value for "${param}".`,
    {
      param,
    },
  )
}

/** Per-item errors inside batch results (`ItemError`). */
export const itemErrors = {
  notFound: (id: number) => ({
    code: 'wpu_not_found',
    message: `Media item ${id} does not exist.`,
  }),
  forbiddenEdit: () => ({
    code: 'wpu_forbidden',
    message: 'You can’t edit media uploaded by others.',
  }),
  forbiddenDelete: () => ({
    code: 'wpu_forbidden',
    message: 'You can’t delete media uploaded by others.',
  }),
  postNotFound: (id: number) => ({
    code: 'wpu_post_not_found',
    message: `Post ${id} does not exist.`,
  }),
  invalidParent: (id: number) => ({
    code: 'wpu_invalid_parent',
    message: `Item ${id} can’t be attached to that.`,
  }),
  notTrashed: (id: number) => ({
    code: 'wpu_not_trashed',
    message: `Media item ${id} is not in the Trash.`,
  }),
  unsupported: (mime: string) => ({
    code: 'wpu_unsupported_type',
    message: `Images of type ${mime} can’t be processed.`,
  }),
}

/** Item errors as the server maps them to whole-request errors (PATCH). */
export function itemErrorToResponse(error: {
  code: string
  message: string
}): FakeError {
  switch (error.code) {
    case 'wpu_forbidden':
      return fakeError(403, 'forbidden', error.message, {
        upstreamStatus: 403,
        upstreamCode: 'wpu_forbidden',
      })
    case 'wpu_not_found':
    case 'wpu_post_not_found':
      return fakeError(404, error.code, error.message)
    default:
      return fakeError(400, error.code, error.message)
  }
}
