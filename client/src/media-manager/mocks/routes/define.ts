// One wrapper for every `api/library/*` mock route, so each behaves like the
// server in front of its handler (server-api.md §2, §9.4):
//
// 1. no session → 401 `unauthorized` (the only 401 anywhere under /api);
// 2. settle due jobs, wait the scenario's latency;
// 3. WordPress unreachable or rejecting the app password → 502;
// 4. plugin not usable → 409 `plugin_incompatible`; missing optional
//    feature → 409 `feature_unavailable`;
// 5. unknown query parameters → 400 `invalid_request`;
// 6. the handler; a thrown `FakeError` becomes its `ApiError` response.
//
// Paths match under any mount (`*/api/library/...`), like the client's
// relative URLs.

import { delay, type HttpHandler, http } from 'msw'
import { PLUGIN_USABLE_STATES } from '../../../../../shared/library-api'
import {
  isOffline,
  type MockContext,
  mockContext,
  pluginStatus,
} from '../context'
import { FakeError } from '../fake/errors'
import type { FakeLibrary } from '../fake/library'
import { rejectUnknownParams } from '../fake/query'
import { apiError, fromFakeError } from '../respond'

export type Method = 'get' | 'post' | 'patch' | 'delete'

export interface RouteRequest {
  mock: MockContext
  library: FakeLibrary
  request: Request
  url: URL
  search: URLSearchParams
  params: Record<string, string | readonly string[] | undefined>
}

export interface RouteSpec {
  method: Method
  /** relative to `api/library/`, MSW syntax (`items/:id`) */
  path: string
  /** allowed query parameters; anything else is a 400 */
  query?: readonly string[]
  /**
   * `library` (default): every guard. `bootstrap`: session only (it reports
   * the rest in its body). `files`: session and WordPress, no plugin check
   * (`plugin/download`).
   */
  guard?: 'library' | 'bootstrap' | 'files'
  /** an optional plugin feature the route needs */
  feature?: string
  /** writes wait the write latency */
  write?: boolean
  handle: (request: RouteRequest) => Response | Promise<Response>
}

export const LIBRARY_PREFIX = '*/api/library/'

function guardError(mock: MockContext, spec: RouteSpec): Response | null {
  const guard = spec.guard ?? 'library'
  if (guard === 'bootstrap') {
    return null
  }
  if (mock.settings.wp === 'unreachable' || isOffline(mock)) {
    return apiError(
      502,
      'wp_unreachable',
      'Could not reach WordPress (ECONNREFUSED).',
      {
        upstreamStatus: null,
      },
    )
  }
  if (mock.settings.wp === 'auth_failed') {
    return apiError(
      502,
      'wp_auth_failed',
      'WordPress rejected the configured credentials.',
      {
        upstreamStatus: 401,
        upstreamCode: 'incorrect_password',
      },
    )
  }
  if (guard === 'files') {
    return null
  }
  const plugin = pluginStatus(mock)
  const usable =
    plugin !== null &&
    (PLUGIN_USABLE_STATES as readonly string[]).includes(plugin.state)
  if (!usable) {
    return apiError(
      409,
      'plugin_incompatible',
      'The companion plugin is missing or not compatible with this app.',
    )
  }
  if (spec.feature && !plugin.features.includes(spec.feature)) {
    return apiError(
      409,
      'feature_unavailable',
      'This needs a newer version of the companion plugin.',
      { feature: spec.feature },
    )
  }
  return null
}

export function libraryRoute(spec: RouteSpec): HttpHandler {
  return http[spec.method](
    `${LIBRARY_PREFIX}${spec.path}`,
    async ({ request, params }) => {
      const mock = mockContext()
      if (!mock.session.loggedIn) {
        return apiError(401, 'unauthorized', 'Log in to continue.')
      }
      mock.library.tick()
      const latency = spec.write
        ? mock.settings.latency.write
        : mock.settings.latency.read
      if (latency > 0) {
        await delay(latency)
      }
      const blocked = guardError(mock, spec)
      if (blocked) {
        return blocked
      }
      const url = new URL(request.url)
      try {
        rejectUnknownParams(url.searchParams, spec.query ?? [])
        return await spec.handle({
          mock,
          library: mock.library,
          request,
          url,
          search: url.searchParams,
          params,
        })
      } catch (error) {
        if (error instanceof FakeError) {
          return fromFakeError(error)
        }
        console.error('Mock route failed', spec.method, spec.path, error)
        return apiError(500, 'internal_error', 'The mock backend failed.')
      }
    },
  )
}
