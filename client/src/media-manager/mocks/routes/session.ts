// The app-root `session` endpoint (log in, log out, current user), as the
// server answers it (server/src/routes/session.ts), so the login screen and
// the session-expired flow work in the mock. Any password logs in except
// `wrong`. Devtools can expire the session (devtools.ts).

import { HttpResponse, http } from 'msw'
import { mockContext } from '../context'
import { apiError } from '../respond'

export const REJECTED_PASSWORD = 'wrong'

export const sessionRoutes = [
  http.get('*/session', () => {
    const { session } = mockContext()
    if (!session.loggedIn) {
      return apiError(401, 'unauthorized', 'Log in to continue.')
    }
    return HttpResponse.json({ username: session.username })
  }),

  http.post('*/session', async ({ request }) => {
    const { session } = mockContext()
    let body: { username?: unknown; password?: unknown } = {}
    try {
      body = (await request.json()) as typeof body
    } catch {
      return apiError(
        400,
        'invalid_json',
        'The request body is not valid JSON.',
      )
    }
    if (
      typeof body.username !== 'string' ||
      typeof body.password !== 'string'
    ) {
      return apiError(400, 'invalid_request', 'Enter a username and password.')
    }
    if (body.password === REJECTED_PASSWORD) {
      return apiError(401, 'invalid_credentials', 'Wrong username or password.')
    }
    session.loggedIn = true
    session.username = body.username || 'dev'
    return HttpResponse.json({ username: session.username })
  }),

  http.delete('*/session', () => {
    mockContext().session.loggedIn = false
    return new HttpResponse(null, { status: 204 })
  }),
]
