import { act, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import type { RequestHandler } from 'msw'
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { userEvent as browserUserEvent } from 'vitest/browser'
import { commandAvailability } from '../../core/commands/registry'
import { coreStore } from '../../core/state'
import { failOnReactWarnings } from '../../test/consoleErrors'
import { cleanupLibrary, renderLibrary } from '../../test/renderLibrary'
import {
  detailRegion,
  findStageMedia,
  firstOfKind,
  liveRegion,
  playableAudio,
  pointer,
  probeLibrary,
  rowsOf,
  stageScroller,
} from './testing'

// The stage per media type (interaction-spec §5), the player bar's keys
// (spike C4), zoom and pan, and the touch gestures (system.md §5), in
// Chromium over the fake library.

failOnReactWarnings()
afterEach(() => {
  cleanupLibrary()
  // Zoom is core state that only an item change resets.
  coreStore.getState().setZoom('fit')
})

// As in detail.browser.spec.tsx: no View Transitions in Vitest's iframe.
const startViewTransition: unknown = Reflect.get(
  document,
  'startViewTransition',
)
beforeAll(() => {
  Reflect.set(document, 'startViewTransition', undefined)
})
afterAll(() => {
  Reflect.set(document, 'startViewTransition', startViewTransition)
})

vi.mock('../inspector', () => ({
  InspectorPanel: () => null,
  register: () => {},
}))

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Opens detail on the first item of a kind through a deep link. */
async function openKind(
  kind: Parameters<typeof firstOfKind>[1],
  options: {
    mime?: string
    handlersFor?: (id: number) => RequestHandler[]
  } = {},
) {
  const { id, index } = firstOfKind(probeLibrary(), kind, options.mime)
  const rendered = await renderLibrary({
    search: `?view=library&item=${id}`,
    waitForGrid: false,
    handlers: options.handlersFor?.(id) ?? [],
  })
  const detail = await detailRegion()
  await findStageMedia()
  return { ...rendered, id, index, detail }
}

function zoomButton(detail: HTMLElement): HTMLElement {
  return within(detail).getByRole('button', { name: /^Zoom/ })
}

describe('the stage per media type', () => {
  it('an image is fitted, with Zoom enabled', async () => {
    const { detail } = await openKind('image')
    const media = await findStageMedia()
    expect(media.tagName).toBe('IMG')
    expect(media.style.width).not.toBe('')
    expect(zoomButton(detail).getAttribute('aria-disabled')).toBeNull()
    expect(zoomButton(detail).textContent).toContain('Fit')
  })

  it('an SVG sits on a checkerboard', async () => {
    await openKind('svg')
    const media = await findStageMedia()
    expect(media.tagName).toBe('IMG')
    expect(media.hasAttribute('data-checker')).toBe(true)
    expect(getComputedStyle(media).backgroundImage).toContain('gradient')
  })

  it('a video shows its poster, the play button and the player bar', async () => {
    const { detail } = await openKind('video')
    const media = await findStageMedia()
    const video = media.querySelector('video')
    expect(video?.getAttribute('poster')).toBeTruthy()
    expect(video?.controls).toBe(false)
    const player = within(detail).getByRole('group', { name: /^Player/ })
    expect(within(player).getByRole('button', { name: 'Play' })).toBeTruthy()
    // Zoom is only for pictures.
    expect(zoomButton(detail).getAttribute('aria-disabled')).toBe('true')
    // The fake's video file is an SVG: it can't play, and says so.
    await waitFor(() =>
      expect(
        within(player).getByText('Can’t play this file here'),
      ).toBeTruthy(),
    )
  })

  it('an audio item is a card with its title, duration and player bar', async () => {
    const { detail, id, mock } = await openKind('audio', {
      handlersFor: (id) => [playableAudio(id, 3)],
    })
    const item = mock.library.item(id)
    const card = await findStageMedia()
    expect(card.textContent).toContain(item?.filename ?? '?')
    expect(card.textContent).toMatch(/Audio · \d+:\d\d/)
    // The file starts loading only once the item stays on stage a moment.
    const audio = detail.querySelector('audio') as HTMLAudioElement
    await waitFor(() => expect(audio.preload).toBe('metadata'))
    const seek = within(detail).getByRole('slider', { name: 'Seek' })
    // The element's own duration replaces the item's once it is known.
    await waitFor(() =>
      expect(Number(seek.getAttribute('max'))).toBeCloseTo(3, 0),
    )
  })

  it('a PDF is a paper sheet with "page 1 of N", Open PDF and Download', async () => {
    const { detail, id, mock } = await openKind('document', {
      mime: 'application/pdf',
    })
    const item = mock.library.item(id)
    const sheet = await findStageMedia()
    expect(sheet.querySelector('img')?.getAttribute('alt')).toMatch(
      /^First page of /,
    )
    expect(detail.textContent).toContain(`page 1 of ${item?.pages}`)
    const open = within(detail).getByRole('link', { name: 'Open PDF' })
    expect(open.getAttribute('target')).toBe('_blank')
    expect(open.getAttribute('href')).toContain(`/${id}/`)
    const download = within(detail).getAllByRole('link', { name: 'Download' })
    expect(
      download.some((link) =>
        link
          .getAttribute('href')
          ?.startsWith(`api/library/items/${id}/download`),
      ),
    ).toBe(true)
  })

  it('an archive is a card with Download', async () => {
    const { detail, id } = await openKind('archive')
    const card = await findStageMedia()
    expect(card.textContent).toMatch(/ZIP archive/)
    const link = within(card).getByRole('link', { name: 'Download' })
    expect(link.getAttribute('href')).toBe(`api/library/items/${id}/download`)
    expect(within(detail).getByRole('button', { name: /^Zoom/ })).toBeTruthy()
  })
})

describe('the player bar', () => {
  async function openAudio() {
    const opened = await openKind('audio', {
      handlersFor: (id) => [playableAudio(id, 4)],
    })
    const audio = opened.detail.querySelector('audio') as HTMLAudioElement
    const seek = within(opened.detail).getByRole('slider', { name: 'Seek' })
    await waitFor(() =>
      expect(Number(seek.getAttribute('max'))).toBeGreaterThan(0),
    )
    return { ...opened, audio, seek }
  }

  it('plays and pauses with the button and with Space', async () => {
    const { detail, audio } = await openAudio()
    await browserUserEvent.click(
      within(detail).getByRole('button', { name: 'Play' }),
    )
    await waitFor(() => expect(audio.paused).toBe(false))
    expect(within(detail).getByRole('button', { name: 'Pause' })).toBeTruthy()
    // Space anywhere in detail mode (here: the region) toggles.
    act(() => detail.focus())
    await browserUserEvent.keyboard(' ')
    await waitFor(() => expect(audio.paused).toBe(true))
    await browserUserEvent.keyboard(' ')
    await waitFor(() => expect(audio.paused).toBe(false))
    audio.pause()
  })

  it('the scrubber seeks with its own keys and doesn’t step; Esc leaves it', async () => {
    const { detail, audio, seek, search, id } = await openAudio()
    act(() => seek.focus())
    // Real key presses: a native range only moves on trusted keys.
    await browserUserEvent.keyboard('{ArrowRight}{ArrowRight}')
    // A native range: arrows seek, they aren't detail.step.
    expect(search()).toContain(`item=${id}`)
    await waitFor(() => expect(audio.currentTime).toBeGreaterThan(0))
    // Space plays and pauses there too (a range ignores it).
    await browserUserEvent.keyboard(' ')
    await waitFor(() => expect(audio.paused).toBe(false))
    await browserUserEvent.keyboard(' ')
    await waitFor(() => expect(audio.paused).toBe(true))
    expect(document.activeElement).toBe(seek)
    // The first Esc leaves the scrubber, the second leaves detail.
    await browserUserEvent.keyboard('{Escape}')
    expect(document.activeElement).toBe(detail)
    expect(search()).toContain(`item=${id}`)
    await browserUserEvent.keyboard('{Escape}')
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Detail' })).toBeNull(),
    )
  })

  it('a video or audio file doesn’t load at once (stepping past loads nothing)', async () => {
    const { detail } = await openKind('video')
    const video = detail.querySelector('video') as HTMLVideoElement
    expect(video.preload).toBe('none')
    expect(video.networkState).toBe(HTMLMediaElement.NETWORK_IDLE)
    await waitFor(() => expect(video.preload).toBe('metadata'))
  })

  it('Space does nothing on an image (nothing to play)', async () => {
    await openKind('image')
    expect(commandAvailability('detail.play-toggle')).toMatchObject({
      ok: false,
      code: 'nothing-to-play',
    })
    expect(document.querySelector('audio, video')).toBeNull()
  })

  it('Space is available while a player is on stage, and not once it is gone', async () => {
    const user = userEvent.setup()
    await openKind('audio', { handlersFor: (id) => [playableAudio(id, 4)] })
    expect(commandAvailability('detail.play-toggle').ok).toBe(true)
    await user.keyboard('{Escape}')
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Detail' })).toBeNull(),
    )
    expect(commandAvailability('detail.play-toggle').ok).toBe(false)
  })
})

describe('zoom and pan', () => {
  it('Z toggles Fit and 100 %, + and - step, and stepping resets to Fit', async () => {
    const user = userEvent.setup()
    const { detail } = await openKind('image')
    const media = await findStageMedia()
    const fitWidth = media.getBoundingClientRect().width
    await user.keyboard('z')
    expect(coreStore.getState().zoom).toBe(1)
    expect(zoomButton(detail).textContent).toContain('100 %')
    expect(zoomButton(detail).getAttribute('aria-pressed')).toBe('true')
    expect(stageScroller().hasAttribute('data-zoomed')).toBe(true)
    await user.keyboard('+')
    expect(coreStore.getState().zoom).toBe(2)
    await user.keyboard('--')
    expect(coreStore.getState().zoom).toBe(0.5)
    await user.keyboard('-')
    expect(coreStore.getState().zoom).toBe('fit')
    expect((await findStageMedia()).getBoundingClientRect().width).toBeCloseTo(
      fitWidth,
      0,
    )
    await user.keyboard('z')
    await user.keyboard('{ArrowRight}')
    expect(coreStore.getState().zoom).toBe('fit')
    expect(stageScroller().hasAttribute('data-zoomed')).toBe(false)
  })

  it('a zoomed picture starts centred and pans with a mouse drag', async () => {
    const user = userEvent.setup()
    await openKind('image')
    await user.keyboard('z')
    const scroller = stageScroller()
    await waitFor(() =>
      expect(scroller.scrollWidth).toBeGreaterThan(scroller.clientWidth),
    )
    const centred = (scroller.scrollWidth - scroller.clientWidth) / 2
    expect(Math.abs(scroller.scrollLeft - centred)).toBeLessThan(60)
    const media = await findStageMedia()
    const start = { left: scroller.scrollLeft, top: scroller.scrollTop }
    pointer(media, 'pointerdown', { x: 500, y: 400, pointerType: 'mouse' })
    pointer(media, 'pointermove', { x: 440, y: 380, pointerType: 'mouse' })
    await waitFor(() =>
      expect(scroller.hasAttribute('data-panning')).toBe(true),
    )
    expect(scroller.scrollLeft).toBeCloseTo(start.left + 60, 0)
    pointer(media, 'pointerup', { x: 440, y: 380, pointerType: 'mouse' })
    await waitFor(() =>
      expect(scroller.hasAttribute('data-panning')).toBe(false),
    )
    expect(getComputedStyle(scroller).cursor).toBe('grab')
  })

  it('a mouse released outside before the drag began leaves no hover-pan', async () => {
    const user = userEvent.setup()
    await openKind('image')
    await user.keyboard('z')
    const scroller = stageScroller()
    await waitFor(() =>
      expect(scroller.scrollWidth).toBeGreaterThan(scroller.clientWidth),
    )
    const media = await findStageMedia()
    const start = scroller.scrollLeft
    pointer(media, 'pointerdown', { x: 500, y: 400, pointerType: 'mouse' })
    // Released elsewhere (no pointerup here); then the mouse just hovers.
    pointer(media, 'pointermove', {
      x: 400,
      y: 400,
      pointerType: 'mouse',
      buttons: 0,
    })
    pointer(media, 'pointermove', {
      x: 300,
      y: 400,
      pointerType: 'mouse',
      buttons: 0,
    })
    expect(scroller.hasAttribute('data-panning')).toBe(false)
    expect(scroller.scrollLeft).toBe(start)
  })

  it('a pinch settles on the nearest zoom level', async () => {
    await openKind('image')
    const media = await findStageMedia()
    const box = media.getBoundingClientRect()
    const centre = { x: box.left + box.width / 2, y: box.top + box.height / 2 }
    pointer(media, 'pointerdown', { id: 1, x: centre.x - 20, y: centre.y })
    pointer(media, 'pointerdown', { id: 2, x: centre.x + 20, y: centre.y })
    // Spread the fingers far apart: well past 100 %.
    pointer(media, 'pointermove', { id: 1, x: centre.x - 400, y: centre.y })
    pointer(media, 'pointermove', { id: 2, x: centre.x + 400, y: centre.y })
    pointer(media, 'pointerup', { id: 2, x: centre.x + 400, y: centre.y })
    pointer(media, 'pointerup', { id: 1, x: centre.x - 400, y: centre.y })
    await waitFor(() => expect(coreStore.getState().zoom).toBe(2))
    // The live transform is gone; the level renders it now.
    const slot = (await findStageMedia()).parentElement as HTMLElement
    expect(slot.style.transform).toBe('')
  })
})

describe('swipe to step on touch (system.md §5)', () => {
  async function openSecond() {
    const rows = rowsOf(probeLibrary())
    const second = rows[1] as { id: number }
    const rendered = await renderLibrary({
      search: `?view=library&item=${second.id}`,
      waitForGrid: false,
    })
    await detailRegion()
    await findStageMedia()
    return { ...rendered, rows }
  }

  it('commits past 64 px, leftwards to the next item, replacing the entry', async () => {
    const { search, rows, history } = await openSecond()
    const media = await findStageMedia()
    const entries = history.entries().searches.length
    pointer(media, 'pointerdown', { x: 600, y: 400 })
    pointer(media, 'pointermove', { x: 560, y: 402 })
    pointer(media, 'pointermove', { x: 500, y: 404 })
    // The picture follows the finger.
    expect(media.parentElement?.style.transform).toBe('translateX(-100px)')
    pointer(media, 'pointerup', { x: 500, y: 404 })
    await waitFor(() => expect(search()).toContain(`item=${rows[2]?.id}`))
    expect(history.entries().searches).toHaveLength(entries)
  })

  it('a short swipe snaps back; a vertical one does nothing', async () => {
    const { search, rows } = await openSecond()
    const media = await findStageMedia()
    // Slowly, so it isn't a flick (synthetic events can't set timeStamp).
    pointer(media, 'pointerdown', { x: 600, y: 400 })
    await pause(150)
    pointer(media, 'pointermove', { x: 570, y: 400 })
    await pause(150)
    pointer(media, 'pointerup', { x: 570, y: 400 })
    expect(search()).toContain(`item=${rows[1]?.id}`)
    expect(media.parentElement?.style.transform).toBe('')
    pointer(media, 'pointerdown', { x: 600, y: 300 })
    pointer(media, 'pointermove', { x: 590, y: 500 })
    pointer(media, 'pointerup', { x: 590, y: 500 })
    expect(search()).toContain(`item=${rows[1]?.id}`)
  })

  it('resists at the first item, and a full swipe there nudges and announces (D34)', async () => {
    const first = rowsOf(probeLibrary())[0] as { id: number }
    const { search } = await renderLibrary({
      search: `?view=library&item=${first.id}`,
      waitForGrid: false,
    })
    const detail = await detailRegion()
    const media = await findStageMedia()
    pointer(media, 'pointerdown', { x: 400, y: 400 })
    pointer(media, 'pointermove', { x: 500, y: 400 })
    // A third of the way only: there is nothing before the first item.
    expect(media.parentElement?.style.transform).toBe('translateX(35px)')
    pointer(media, 'pointerup', { x: 500, y: 400 })
    expect(search()).toContain(`item=${first.id}`)
    // The nudge clears when its animation ends: check it first.
    await waitFor(() =>
      expect(detail.querySelector('[data-nudge]')).not.toBeNull(),
    )
    await waitFor(() => expect(liveRegion()).toBe('First item in this view'))
  })

  /** A video the browser can play (a WAV works in a <video> too). */
  async function openPlayableVideo() {
    const opened = await openKind('video', {
      handlersFor: (id) => [playableAudio(id, 4)],
    })
    const video = opened.detail.querySelector('video') as HTMLVideoElement
    await waitFor(() => expect(video.readyState).toBeGreaterThan(0))
    expect(
      within(opened.detail).queryByText('Can’t play this file here'),
    ).toBeNull()
    return { ...opened, video }
  }

  it('a swipe over a video doesn’t also play it', async () => {
    const { search, index, mock, video } = await openPlayableVideo()
    const rows = rowsOf(mock)
    const play = vi.spyOn(video, 'play')
    pointer(video, 'pointerdown', { x: 600, y: 300 })
    pointer(video, 'pointermove', { x: 480, y: 300 })
    pointer(video, 'pointerup', { x: 480, y: 300 })
    // The click a real touch would send right after the drag is cancelled.
    const delivered = video.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }),
    )
    expect(delivered).toBe(false)
    expect(play).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(search()).toContain(`item=${rows[index + 1]?.id}`),
    )
  })

  it('after a swipe that snapped back, a tap plays and Enter on Play works', async () => {
    const { detail, video } = await openPlayableVideo()
    const play = vi.spyOn(video, 'play')
    // Slowly and short: it snaps back and stays on this video.
    pointer(video, 'pointerdown', { x: 600, y: 300 })
    await pause(150)
    pointer(video, 'pointermove', { x: 570, y: 300 })
    await pause(150)
    pointer(video, 'pointerup', { x: 570, y: 300 })
    // A keyboard activation right away is not the drag's click.
    const button = within(detail).getByRole('button', { name: 'Play' })
    act(() => button.focus())
    await browserUserEvent.keyboard('{Enter}')
    await waitFor(() => expect(play).toHaveBeenCalledTimes(1))
    video.pause()
    // And the suppression doesn't outlive the drag: a later tap plays.
    await pause(400)
    video.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }),
    )
    await waitFor(() => expect(play).toHaveBeenCalledTimes(2))
    video.pause()
  })
})
