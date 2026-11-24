import { delay, HttpResponse, http } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { mockNetwork } from '../../test/msw'
import { startUpload } from './transport'

// startUpload() uses a real XMLHttpRequest, so these run in Chromium, with
// MSW's service worker answering `api/library/upload`.

function file(): File {
  return new File(['hello'], 'hello.txt', { type: 'text/plain' })
}

describe('startUpload() aborts', () => {
  it('rejects at once, without sending, when the signal is already aborted', async () => {
    const handler = vi.fn(() =>
      HttpResponse.json({ jobId: 'never' }, { status: 202 }),
    )
    mockNetwork.use(http.post('*/api/library/upload', handler))
    const controller = new AbortController()
    controller.abort()
    await expect(
      startUpload(file(), { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(handler).not.toHaveBeenCalled()
  })

  it('rejects with an AbortError when aborted mid-upload', async () => {
    let received: () => void = () => {}
    const arrived = new Promise<void>((resolve) => {
      received = resolve
    })
    mockNetwork.use(
      http.post('*/api/library/upload', async () => {
        received()
        await delay('infinite')
        return HttpResponse.json({ jobId: 'late' }, { status: 202 })
      }),
    )
    const controller = new AbortController()
    const pending = startUpload(file(), { signal: controller.signal })
    await arrived
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('removes its abort listener once the upload has settled', async () => {
    mockNetwork.use(
      http.post('*/api/library/upload', () =>
        HttpResponse.json({ jobId: 'job-1' }, { status: 202 }),
      ),
    )
    const controller = new AbortController()
    const removed = vi.spyOn(controller.signal, 'removeEventListener')
    await expect(
      startUpload(file(), { signal: controller.signal }),
    ).resolves.toMatchObject({ jobId: 'job-1' })
    expect(removed).toHaveBeenCalledWith('abort', expect.any(Function))
  })

  it('removes its abort listener after a network error', async () => {
    mockNetwork.use(
      http.post('*/api/library/upload', () => HttpResponse.error()),
    )
    const controller = new AbortController()
    const removed = vi.spyOn(controller.signal, 'removeEventListener')
    await expect(
      startUpload(file(), { signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'network_error' })
    expect(removed).toHaveBeenCalledWith('abort', expect.any(Function))
  })
})
