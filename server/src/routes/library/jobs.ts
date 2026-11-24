import type { Request } from 'express'
import { Router } from 'express'
import {
  type JobKind,
  type JobsResponse,
  LIMITS,
} from '../../../../shared/library-api.ts'
import { sendNoStore } from '../../lib/library/cache.ts'
import {
  asyncRoute,
  invalidRequest,
  queryParams,
} from '../../lib/library/errors.ts'
import { lookupJob } from '../../lib/library/jobs.ts'

// GET jobs (server-api.md §7.13): polls jobs of any kind. `upload/jobs`
// (upload.ts) reads the same registry but only finds upload jobs.

export const jobsRouter = Router()

/** Job ids are opaque strings; ours are UUIDs. */
const JOB_ID = /^[A-Za-z0-9-]{1,64}$/

/** `ids=` of a jobs poll: 1–LIMITS.jobIds job ids, deduplicated, in order. */
export function parseJobIds(raw: string | undefined): string[] {
  if (raw === undefined) throw invalidRequest('ids', 'ids is required.')
  const ids = [...new Set(raw.split(',').map((id) => id.trim()))]
  if (ids.some((id) => !JOB_ID.test(id))) {
    throw invalidRequest('ids', 'ids: job ids are letters, digits and dashes.')
  }
  if (ids.length > LIMITS.jobIds) {
    throw invalidRequest(
      'ids',
      `ids: at most ${LIMITS.jobIds} job ids per request.`,
    )
  }
  return ids
}

/** Answers a jobs poll, finding only jobs of `kinds` (all when omitted). */
export function jobsResponse(
  req: Request,
  kinds?: readonly JobKind[],
): JobsResponse {
  const raw = queryParams(req, ['ids'])
  const ids = parseJobIds(raw.ids)
  return { jobs: ids.map((id) => lookupJob(id, kinds)) }
}

jobsRouter.get(
  '/jobs',
  asyncRoute(async (req, res) => {
    sendNoStore(res, jobsResponse(req))
  }),
)
