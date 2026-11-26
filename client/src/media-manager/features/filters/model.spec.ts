import { describe, expect, it } from 'vitest'
import { SORT_KEYS } from '../../../../../shared/library-api'
import {
  activeExtraChips,
  formatBytes,
  monthLabel,
  SORT_LABELS,
  summaryText,
  typeChips,
} from './model'

const FOLDER = {
  total: 18,
  bytes: 126_891_208,
  types: { image: 13, video: 2, audio: 0, document: 3 },
  missingAlt: 4,
  unused: 10,
  editable: 18,
}

describe('typeChips', () => {
  it('shows All plus every type with items, with the folder counts', () => {
    expect(typeChips(FOLDER, null)).toEqual([
      { type: null, label: 'All', count: 18, active: true },
      { type: 'image', label: 'Images', count: 13, active: false },
      { type: 'video', label: 'Video', count: 2, active: false },
      { type: 'document', label: 'Documents', count: 3, active: false },
    ])
  })

  it('keeps an active type with no items, so it can be turned off', () => {
    const chips = typeChips(FOLDER, 'audio')
    expect(chips.map((chip) => chip.type)).toEqual([
      null,
      'image',
      'video',
      'audio',
      'document',
    ])
    expect(chips.find((chip) => chip.active)?.type).toBe('audio')
  })
})

describe('activeExtraChips', () => {
  it('lists the active size, orientation and month filters in order', () => {
    expect(activeExtraChips({ size: null, orient: null, month: null })).toEqual(
      [],
    )
    expect(
      activeExtraChips({ size: 'gt5', orient: 'portrait', month: '2026-11' }),
    ).toEqual([
      { filter: 'size', label: '> 5 MB' },
      { filter: 'orient', label: 'Portrait' },
      { filter: 'month', label: 'November 2026' },
    ])
  })
})

describe('labels and formats', () => {
  it('labels every sort key', () => {
    for (const key of SORT_KEYS) {
      expect(SORT_LABELS[key]).toBeTruthy()
    }
  })

  it('names months in English whatever the time zone', () => {
    expect(monthLabel('2024-01')).toBe('January 2024')
    expect(monthLabel('2026-12')).toBe('December 2026')
    expect(monthLabel('nonsense')).toBe('nonsense')
  })

  it('formats sizes in decimal units', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(999)).toBe('999 B')
    expect(formatBytes(1000)).toBe('1.0 kB')
    expect(formatBytes(126_891_208)).toBe('127 MB')
    expect(formatBytes(12_345_678)).toBe('12.3 MB')
    expect(formatBytes(4_200_000_000)).toBe('4.2 GB')
  })

  it('writes the summary, with the size once it is known', () => {
    expect(summaryText(1, null)).toBe('1 item')
    expect(summaryText(50_000, 4_200_000_000)).toBe('50,000 items · 4.2 GB')
  })
})
