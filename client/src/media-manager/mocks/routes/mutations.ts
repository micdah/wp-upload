// Metadata, delete and trash mutations: PATCH items/:id, items/batch,
// items/delete, trash/restore, trash/empty. server-api.md §7.6–7.8, §7.14.

import { z } from 'zod'
import * as S from '../../../../../shared/library-api.schema'
import { idParam, json, readBody } from '../respond'
import { libraryRoute } from './define'

export const mutationRoutes = [
  libraryRoute({
    method: 'patch',
    path: 'items/:id',
    write: true,
    handle: async ({ library, request, params }) => {
      const id = idParam(params.id)
      const patch = await readBody(request, S.NonEmptyItemPatchSchema)
      const body = library.patchItem(id, patch)
      return json(S.ItemPatchResponseSchema, body, { rev: body.rev })
    },
  }),

  libraryRoute({
    method: 'post',
    path: 'items/batch',
    write: true,
    handle: async ({ library, request }) => {
      const batch = await readBody(request, S.BatchRequestSchema)
      const body = library.batch(batch)
      return json(S.BatchResponseSchema, body, { rev: body.rev })
    },
  }),

  libraryRoute({
    method: 'post',
    path: 'items/delete',
    write: true,
    handle: async ({ library, request }) => {
      const deletion = await readBody(request, S.DeleteRequestSchema)
      const body = library.deleteItems(deletion)
      return json(S.DeleteResponseSchema, body, { rev: body.rev })
    },
  }),

  libraryRoute({
    method: 'post',
    path: 'trash/restore',
    write: true,
    handle: async ({ library, request }) => {
      const { ids } = await readBody(request, S.RestoreRequestSchema)
      const body = library.restore(ids)
      return json(S.RestoreResponseSchema, body, { rev: body.rev })
    },
  }),

  libraryRoute({
    method: 'post',
    path: 'trash/empty',
    write: true,
    handle: async ({ library, request }) => {
      // No body, or `{}`.
      await readBody(request, z.object({}))
      const body = library.emptyTrashStep()
      return json(S.EmptyTrashResponseSchema, body, { rev: body.rev })
    },
  }),
]
