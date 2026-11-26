// Helpers for detail's browser specs (not shipped: only specs import it).

import { screen, waitFor } from '@testing-library/react'
import { HttpResponse, http } from 'msw'
import {
  type CollectionQuery,
  MEDIA_KINDS,
  type MediaKind,
} from '../../../../../shared/library-api'
import { createMockContext, type MockContext } from '../../mocks/context'
import { resolveSettings } from '../../mocks/scenarios'

/** The default view (All files, newest first), as the fake answers it. */
export const ALL_FILES: CollectionQuery = {
  folder: 'all',
  q: null,
  type: null,
  alt: null,
  size: null,
  orient: null,
  month: null,
  sort: 'date-desc',
}

/**
 * A fake library like the one renderLibrary() starts, without the app or
 * the network: for reading ids before rendering (the fake is deterministic
 * per scenario).
 */
export function probeLibrary(scenario = 'normal'): MockContext {
  return createMockContext(
    {
      ...resolveSettings(`mock-scenario=${encodeURIComponent(scenario)}`),
      latency: { read: 0, write: 0 },
      jobSpeed: 0,
    },
    { mediaBase: new URL('mock-media/', window.location.href).href },
  )
}

/** Ids in the default view, in order, with their kinds. */
export function rowsOf(
  mock: MockContext,
  query: CollectionQuery = ALL_FILES,
): { id: number; kind: MediaKind }[] {
  const { rows } = mock.library.collection(query)
  const result: { id: number; kind: MediaKind }[] = []
  for (let offset = 0; offset < rows.length; offset += 4) {
    result.push({
      id: rows[offset] as number,
      kind: MEDIA_KINDS[rows[offset + 3] as number] ?? 'other',
    })
  }
  return result
}

/** The first item of a kind in the default view (and its position). */
export function firstOfKind(
  mock: MockContext,
  kind: MediaKind,
  mime?: string,
): { id: number; index: number } {
  const rows = rowsOf(mock)
  const index = rows.findIndex(
    (row) =>
      row.kind === kind &&
      (mime === undefined || mock.library.item(row.id)?.mime === mime),
  )
  if (index === -1) throw new Error(`no ${kind} item in the fake library`)
  return { id: (rows[index] as { id: number }).id, index }
}

export async function detailRegion(): Promise<HTMLElement> {
  // The overlay is a lazy chunk; Vitest transforms it on first use, which
  // takes more than findBy's default second in a loaded full run.
  return screen.findByRole('region', { name: 'Detail' }, { timeout: 5000 })
}

/** The live region's text now. */
export function liveRegion(): string {
  return document.querySelector('[data-mm-live-region]')?.textContent ?? ''
}

export function stageMedia(): HTMLElement {
  const element = document.querySelector<HTMLElement>('[data-mm-stage-media]')
  if (!element) throw new Error('no stage media yet')
  return element
}

export async function findStageMedia(): Promise<HTMLElement> {
  return waitFor(stageMedia)
}

/** The stage's scroller (where gestures are handled). */
export function stageScroller(): HTMLElement {
  const element = document.querySelector<HTMLElement>('[data-mm-stage]')
  if (!element) throw new Error('no stage')
  return element
}

/**
 * A WAV of silence, so the fake's audio plays in the browser: 8 kHz mono
 * 8-bit PCM.
 */
export function silentWav(seconds: number): ArrayBuffer {
  const rate = 8000
  const samples = Math.round(rate * seconds)
  const buffer = new ArrayBuffer(44 + samples)
  const view = new DataView(buffer)
  const text = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index))
    }
  }
  text(0, 'RIFF')
  view.setUint32(4, 36 + samples, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, rate, true)
  view.setUint32(28, rate, true) // bytes per second
  view.setUint16(32, 1, true) // block align
  view.setUint16(34, 8, true) // bits per sample
  text(36, 'data')
  view.setUint32(40, samples, true)
  new Uint8Array(buffer, 44).fill(128) // silence in 8-bit PCM
  return buffer
}

/**
 * Serves a playable WAV for one item's file, in front of the fake, with
 * byte ranges (as a web server does), so the browser can seek in it.
 */
export function playableAudio(id: number, seconds = 4) {
  const file = silentWav(seconds)
  return http.get(`*/mock-media/${id}/full/*`, ({ request }) => {
    const range = /bytes=(\d+)-(\d*)/.exec(request.headers.get('range') ?? '')
    if (!range) {
      return HttpResponse.arrayBuffer(file, {
        headers: { 'Content-Type': 'audio/wav', 'Accept-Ranges': 'bytes' },
      })
    }
    const start = Number(range[1])
    const end = range[2] ? Number(range[2]) : file.byteLength - 1
    return HttpResponse.arrayBuffer(file.slice(start, end + 1), {
      status: 206,
      headers: {
        'Content-Type': 'audio/wav',
        'Accept-Ranges': 'bytes',
        'Content-Range': `bytes ${start}-${end}/${file.byteLength}`,
      },
    })
  })
}

/** A synthetic pointer event at a point (touch by default). */
export function pointer(
  target: Element,
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  init: {
    x: number
    y: number
    id?: number
    pointerType?: 'touch' | 'mouse' | 'pen'
    /** Buttons held (default: 1 while down or moving, 0 on release). */
    buttons?: number
  },
): void {
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      pointerId: init.id ?? 1,
      pointerType: init.pointerType ?? 'touch',
      isPrimary: (init.id ?? 1) === 1,
      clientX: init.x,
      clientY: init.y,
      button: type === 'pointermove' ? -1 : 0,
      buttons:
        init.buttons ??
        (type === 'pointerup' || type === 'pointercancel' ? 0 : 1),
    }),
  )
}
