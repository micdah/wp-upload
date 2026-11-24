// Folder mutations: create, update (rename, move, reorder, colour), delete,
// assign. server-api.md §7.11. `GET folders` is in read.ts.

import * as S from '../../../../../shared/library-api.schema'
import { idParam, json, readBody } from '../respond'
import { libraryRoute } from './define'

export const folderRoutes = [
  libraryRoute({
    method: 'post',
    path: 'folders/assign',
    write: true,
    handle: async ({ library, request }) => {
      const { folder, ids } = await readBody(
        request,
        S.FolderAssignRequestSchema,
      )
      const body = library.assign(folder, ids)
      return json(S.FolderAssignResponseSchema, body, { rev: body.rev })
    },
  }),

  libraryRoute({
    method: 'post',
    path: 'folders',
    write: true,
    handle: async ({ library, request }) => {
      const create = await readBody(request, S.FolderCreateRequestSchema)
      const body = library.createFolder(create)
      return json(S.FolderMutationResponseSchema, body, {
        rev: body.rev,
        status: 201,
      })
    },
  }),

  libraryRoute({
    method: 'patch',
    path: 'folders/:id',
    write: true,
    handle: async ({ library, request, params }) => {
      const id = idParam(params.id)
      const update = await readBody(request, S.FolderUpdateRequestSchema)
      const body = library.updateFolder(id, update)
      return json(S.FolderMutationResponseSchema, body, { rev: body.rev })
    },
  }),

  libraryRoute({
    method: 'delete',
    path: 'folders/:id',
    write: true,
    handle: ({ library, params }) => {
      const body = library.deleteFolder(idParam(params.id))
      return json(S.FolderDeleteResponseSchema, body, { rev: body.rev })
    },
  }),
]
