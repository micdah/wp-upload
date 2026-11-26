import { describe, expect, it } from 'vitest'
import {
  checkerboardOf,
  formatDuration,
  isMissingAlt,
  tileBadges,
  uploadLook,
} from './badges'

const IMAGE = {
  kind: 'image' as const,
  alt: 'A beach',
  mime: 'image/jpeg',
  duration: null,
  pages: null,
  sizesPending: false,
}

function ids(badges: ReturnType<typeof tileBadges>): string[] {
  return badges.map((badge) => badge.id)
}

describe('formatDuration', () => {
  it('writes m:ss below an hour and h:mm:ss from an hour', () => {
    expect(formatDuration(0)).toBe('0:00')
    expect(formatDuration(5)).toBe('0:05')
    expect(formatDuration(65.4)).toBe('1:05')
    expect(formatDuration(599.6)).toBe('10:00')
    expect(formatDuration(3600)).toBe('1:00:00')
    expect(formatDuration(3725)).toBe('1:02:05')
    expect(formatDuration(-3)).toBe('0:00')
  })
})

describe('tileBadges', () => {
  it('shows nothing on a described image', () => {
    expect(tileBadges(IMAGE)).toEqual([])
  })

  it('flags missing alt on images and SVGs only, ignoring whitespace', () => {
    expect(ids(tileBadges({ ...IMAGE, alt: '' }))).toEqual(['alt'])
    expect(ids(tileBadges({ ...IMAGE, alt: '   ' }))).toEqual(['alt'])
    expect(ids(tileBadges({ ...IMAGE, kind: 'svg', alt: '' }))).toEqual(['alt'])
    expect(isMissingAlt({ kind: 'video', alt: '' })).toBe(false)
    expect(
      tileBadges({ ...IMAGE, kind: 'document', alt: '', mime: 'text/plain' }),
    ).toEqual([])
  })

  it('shows the duration of video and audio with a spoken label', () => {
    const [badge] = tileBadges({
      ...IMAGE,
      kind: 'video',
      alt: '',
      mime: 'video/mp4',
      duration: 125,
    })
    expect(badge).toMatchObject({
      id: 'duration',
      text: '2:05',
      label: 'Duration 2:05',
    })
    expect(
      tileBadges({ ...IMAGE, kind: 'audio', mime: 'audio/mpeg', duration: 1 }),
    ).toMatchObject([{ text: '0:01', label: 'Duration 0:01' }])
    // Unknown duration: no badge.
    expect(tileBadges({ ...IMAGE, kind: 'audio', mime: 'audio/mpeg' })).toEqual(
      [],
    )
  })

  it('shows the page count of PDFs only', () => {
    expect(
      tileBadges({
        ...IMAGE,
        kind: 'document',
        mime: 'application/pdf',
        pages: 12,
      }),
    ).toMatchObject([
      { id: 'pages', text: 'PDF · 12 p', label: 'PDF, 12 pages' },
    ])
    expect(
      tileBadges({
        ...IMAGE,
        kind: 'document',
        mime: 'application/pdf',
        pages: 1,
      })[0]?.label,
    ).toBe('PDF, 1 page')
    expect(
      tileBadges({
        ...IMAGE,
        kind: 'document',
        mime: 'application/msword',
        pages: 3,
      }),
    ).toEqual([])
  })

  it('puts processing and failed uploads first', () => {
    expect(ids(tileBadges({ ...IMAGE, alt: '', sizesPending: true }))).toEqual([
      'processing',
      'alt',
    ])
    const processing = {
      phase: 'processing' as const,
      progress: null,
      error: null,
      previewUrl: null,
    }
    expect(ids(tileBadges(IMAGE, processing))).toEqual(['processing'])
    expect(
      ids(
        tileBadges(
          { ...IMAGE, sizesPending: true },
          { ...processing, phase: 'error', error: 'Timed out' },
        ),
      ),
    ).toEqual(['failed'])
    expect(
      ids(tileBadges(IMAGE, { ...processing, phase: 'uploading' })),
    ).toEqual([])
  })
})

describe('checkerboardOf', () => {
  it('puts SVG (contained) and PNG (cover) on a checkerboard', () => {
    expect(checkerboardOf({ kind: 'svg', mime: 'image/svg+xml' })).toBe(
      'contain',
    )
    expect(checkerboardOf({ kind: 'image', mime: 'image/png' })).toBe('cover')
    expect(checkerboardOf({ kind: 'image', mime: 'image/jpeg' })).toBeNull()
    expect(checkerboardOf({ kind: 'video', mime: 'video/mp4' })).toBeNull()
  })
})

describe('uploadLook', () => {
  const base = { progress: null, error: null, previewUrl: null }

  it('maps each upload phase to its ring', () => {
    expect(uploadLook(null)).toBeNull()
    expect(uploadLook({ ...base, phase: 'queued' })).toEqual({
      phase: 'queued',
      progress: 0,
      text: null,
    })
    expect(
      uploadLook({ ...base, phase: 'uploading', progress: 0.424 }),
    ).toEqual({ phase: 'uploading', progress: 0.424, text: '42 %' })
    expect(uploadLook({ ...base, phase: 'uploading', progress: 1.4 })).toEqual({
      phase: 'uploading',
      progress: 1,
      text: '100 %',
    })
    expect(uploadLook({ ...base, phase: 'uploading' })).toEqual({
      phase: 'uploading',
      progress: null,
      text: null,
    })
    expect(uploadLook({ ...base, phase: 'processing' })?.progress).toBeNull()
    expect(uploadLook({ ...base, phase: 'error' })?.phase).toBe('error')
  })
})
