// Every MSW handler of the mock backend, in matching order:
//
// 1. the feature tracks' handlers (mocks/handlers/<feature>.ts), first, so a
//    feature can add routes or override a core one while it builds;
// 2. the core routes (mocks/routes/), one per server route;
// 3. a catch-all that answers unknown `api/library/*` routes with 404
//    `not_found`, as the server does.
//
// Feature handlers read the running fake with `mockContext()` (context.ts)
// and should go through `libraryRoute` (routes/define.ts) so they get the
// same guards, and through `json()` (respond.ts) so their responses are
// checked against the contract's schemas.

import type { HttpHandler } from 'msw'
import { http } from 'msw'
import { mockContext } from './context'
import { handlers as commandUi } from './handlers/command-ui'
import { handlers as detail } from './handlers/detail'
import { handlers as editor } from './handlers/editor'
import { handlers as filters } from './handlers/filters'
import { handlers as folders } from './handlers/folders'
import { handlers as grid } from './handlers/grid'
import { handlers as inspector } from './handlers/inspector'
import { handlers as peek } from './handlers/peek'
import { handlers as phone } from './handlers/phone'
import { handlers as system } from './handlers/system'
import { handlers as trash } from './handlers/trash'
import { handlers as upload } from './handlers/upload'
import { apiError } from './respond'
import { fileRoutes } from './routes/files'
import { folderRoutes } from './routes/folders'
import { jobRoutes } from './routes/jobs'
import { mutationRoutes } from './routes/mutations'
import { readRoutes } from './routes/read'
import { sessionRoutes } from './routes/session'

export const featureHandlers: HttpHandler[] = [
  ...grid,
  ...filters,
  ...peek,
  ...detail,
  ...folders,
  ...inspector,
  ...editor,
  ...upload,
  ...trash,
  ...system,
  ...commandUi,
  ...phone,
]

export const coreHandlers: HttpHandler[] = [
  ...sessionRoutes,
  ...readRoutes,
  ...mutationRoutes,
  ...folderRoutes,
  ...jobRoutes,
  ...fileRoutes,
]

const notFound = http.all('*/api/library/*', () => {
  if (!mockContext().session.loggedIn) {
    return apiError(401, 'unauthorized', 'Log in to continue.')
  }
  return apiError(404, 'not_found', 'Not found.')
})

export const handlers: HttpHandler[] = [
  ...featureHandlers,
  ...coreHandlers,
  notFound,
]
