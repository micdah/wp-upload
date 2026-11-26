import { describe, expect, it } from 'vitest'
import { formatBytes, isImageLike, kindLabel, splitFileName } from './format'

describe('splitFileName', () => {
  it('keeps the extension and the end of the name in the tail', () => {
    expect(splitFileName('still-life-joshua-earle-548-scaled.jpg')).toEqual({
      head: 'still-life-joshua-earle-548-',
      tail: 'scaled.jpg',
    })
  })

  it('leaves short names whole', () => {
    expect(splitFileName('logo.svg')).toEqual({ head: '', tail: 'logo.svg' })
  })

  it('splits names without an extension too', () => {
    const { head, tail } = splitFileName('a-very-long-name-without-dot')
    expect(head + tail).toBe('a-very-long-name-without-dot')
    expect(tail).toBe('ut-dot')
  })
})

describe('formatBytes', () => {
  it('uses 1000-based units with one decimal below 10', () => {
    expect(formatBytes(840)).toBe('840 B')
    expect(formatBytes(312_400)).toBe('312 KB')
    expect(formatBytes(4_210_000)).toBe('4.2 MB')
    expect(formatBytes(2_500_000_000)).toBe('2.5 GB')
  })
})

describe('kinds', () => {
  it('knows which kinds have alt text', () => {
    expect(isImageLike('image')).toBe(true)
    expect(isImageLike('svg')).toBe(true)
    expect(isImageLike('video')).toBe(false)
    expect(isImageLike(undefined)).toBe(false)
  })

  it('labels kinds', () => {
    expect(kindLabel('svg')).toBe('SVG')
    expect(kindLabel('other')).toBe('File')
  })
})
