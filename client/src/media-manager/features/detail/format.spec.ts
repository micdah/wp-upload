import { describe, expect, it } from 'vitest'
import {
  cardMeta,
  fileTypeLabel,
  formatBytes,
  formatDuration,
  spokenDuration,
} from './format'

describe('formatDuration', () => {
  it('reads m:ss, and h:mm:ss from an hour', () => {
    expect(formatDuration(7)).toBe('0:07')
    expect(formatDuration(245.9)).toBe('4:05')
    expect(formatDuration(1843)).toBe('30:43')
    expect(formatDuration(3729)).toBe('1:02:09')
  })

  it('reads 0:00 for unknown or broken values', () => {
    expect(formatDuration(null)).toBe('0:00')
    expect(formatDuration(Number.NaN)).toBe('0:00')
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('0:00')
    expect(formatDuration(-3)).toBe('0:00')
  })
})

describe('spokenDuration', () => {
  it('names the units', () => {
    expect(spokenDuration(0)).toBe('0 seconds')
    expect(spokenDuration(1)).toBe('1 second')
    expect(spokenDuration(245)).toBe('4 minutes 5 seconds')
    expect(spokenDuration(3600)).toBe('1 hour')
    expect(spokenDuration(3661)).toBe('1 hour 1 minute 1 second')
  })
})

describe('formatBytes', () => {
  it('is 1000-based with one decimal below 10', () => {
    expect(formatBytes(840)).toBe('840 B')
    expect(formatBytes(402_000)).toBe('402 KB')
    expect(formatBytes(4_200_000)).toBe('4.2 MB')
    expect(formatBytes(28_400_000)).toBe('28 MB')
    expect(formatBytes(1_500_000_000)).toBe('1.5 GB')
  })
})

describe('fileTypeLabel', () => {
  it('names archives and documents by their extension', () => {
    expect(fileTypeLabel('archive', 'brand-assets.zip')).toBe('ZIP archive')
    expect(fileTypeLabel('archive', 'noext')).toBe('Archive')
    expect(fileTypeLabel('document', 'notes.docx')).toBe('DOCX')
    expect(fileTypeLabel('other', 'data.csv')).toBe('CSV')
  })

  it('names other kinds by the kind', () => {
    expect(fileTypeLabel('audio', 'a.mp3')).toBe('Audio')
    expect(fileTypeLabel('other', 'README')).toBe('File')
  })
})

describe('cardMeta', () => {
  it('joins the known parts', () => {
    expect(cardMeta(['PDF', 'page 1 of 3', '402 KB'])).toBe(
      'PDF · page 1 of 3 · 402 KB',
    )
    expect(cardMeta(['PDF', false, null, '402 KB'])).toBe('PDF · 402 KB')
  })
})
