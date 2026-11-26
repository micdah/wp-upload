import { afterEach, describe, expect, it, vi } from 'vitest'
import { jobUploadSucceeded } from '../../../../../shared/fixtures/jobs'
import { LibraryError } from '../data/errors'
import {
  getTileUploadState,
  rekeyTileUploadState,
  setTileUploadState,
} from './tileState'
import { cancelUploadJob, checkDuplicate, fetchUploadJobs } from './transport'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('upload transport', () => {
  it('polls job states with relative URLs, chunked at 100 ids', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const ids =
        new URL(url, 'https://example.com/').searchParams
          .get('ids')
          ?.split(',') ?? []
      return json({ jobs: ids.map((id) => ({ id, state: 'not_found' })) })
    })
    vi.stubGlobal('fetch', fetchMock)
    const ids = Array.from({ length: 150 }, (_, index) => `job-${index}`)
    const result = await fetchUploadJobs(ids)
    expect(result.jobs).toHaveLength(150)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const firstUrl = fetchMock.mock.calls[0]?.[0] as string
    expect(
      firstUrl.startsWith('api/library/upload/jobs?ids=job-0%2Cjob-1'),
    ).toBe(true)
  })

  it('reads a succeeded upload job', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ jobs: [jobUploadSucceeded] })),
    )
    const result = await fetchUploadJobs([jobUploadSucceeded.id])
    expect(result.jobs[0]).toEqual(jobUploadSucceeded)
  })

  it('cancel: 204 is true, 404 is false', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 204 })),
    )
    expect(await cancelUploadJob('a')).toBe(true)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ code: 'job_not_found', message: 'gone' }, 404)),
    )
    expect(await cancelUploadJob('a')).toBe(false)
  })

  it('errors carry the server code and message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json(
          { code: 'wp_unreachable', message: 'WordPress did not answer.' },
          502,
        ),
      ),
    )
    const error = await checkDuplicate('a.jpg').catch(
      (caught: unknown) => caught,
    )
    expect(error).toBeInstanceOf(LibraryError)
    expect(error).toMatchObject({
      status: 502,
      code: 'wp_unreachable',
      message: 'WordPress did not answer.',
    })
  })
})

describe('tile upload state', () => {
  it('sets, re-keys from a temporary key to the item id, and clears', () => {
    setTileUploadState('tmp-1', {
      phase: 'uploading',
      progress: 0.4,
      error: null,
      previewUrl: 'blob:x',
    })
    rekeyTileUploadState('tmp-1', 1201)
    expect(getTileUploadState('tmp-1')).toBeNull()
    expect(getTileUploadState(1201)).toMatchObject({
      phase: 'uploading',
      progress: 0.4,
    })
    setTileUploadState(1201, null)
    expect(getTileUploadState(1201)).toBeNull()
  })
})
